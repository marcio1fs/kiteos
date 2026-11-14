import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/auth';
import { calculateIssqn, validateNfseData, generateNfseXml, getCurrentCompetencia } from '@/lib/nfse';
import { NFSE_RPS_STATUS, fiscalErrorResponse } from '@/lib/fiscal/document-status';

// GET /api/nfse - List NFS-e for an office
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const status = searchParams.get('status');
    const competencia = searchParams.get('competencia');
    const search = searchParams.get('search');

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const where: Record<string, unknown> = {
      officeId,
      deleted: false,
    };

    if (status) where.status = status;
    if (competencia) where.competencia = competencia;
    if (search) {
      where.OR = [
        { numero: { contains: search } },
        { clienteNome: { contains: search } },
        { clienteCpfCnpj: { contains: search } },
        { discriminacao: { contains: search } },
      ];
    }

    const nfseList = await db.nfseServico.findMany({
      where,
      include: {
        client: { select: { id: true, name: true, cpfCnpj: true } },
      },
      orderBy: { dataEmissao: 'desc' },
    });

    return NextResponse.json({ success: true, data: nfseList });
  } catch (error) {
    logger.error('Error listing NFS-e:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao listar NFS-e' },
      { status: 500 }
    );
  }
}

// POST /api/nfse - Create NFS-e from service order or sale
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      officeId,
      serviceOrderId,
      saleId,
      numero: numeroInformado,
      competencia,
      itemListaServico,
      discriminacao,
      valorServicos,
      valorDeducoes = 0,
      aliqIssqn,
      tipoTributacao = 'ISSQN',
      clienteCpfCnpj,
      clienteNome,
      clienteEndereco,
      clienteEmail,
      clientId,
    } = body;

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    // FISC-08: a alíquota de ISS é municipal e varia por serviço. O fallback
    // silencioso para 5% produzia cálculo fiscal errado; quando o regime é ISSQN
    // a alíquota é obrigatória e a ausência vira NaN, que validateNfseData recusa.
    const aliqInformada = aliqIssqn === undefined || aliqIssqn === null || aliqIssqn === ''
      ? Number.NaN
      : Number(aliqIssqn);

    // Build NFS-e data
    const nfseData = {
      numero: numeroInformado || '',
      competencia: competencia || getCurrentCompetencia(),
      itemListaServico: itemListaServico || '14.01',
      discriminacao: discriminacao || '',
      valorServicos: Number(valorServicos) || 0,
      valorDeducoes: Number(valorDeducoes) || 0,
      aliqIssqn: tipoTributacao === 'ISSQN' ? aliqInformada : 0,
      tipoTributacao: tipoTributacao as 'ISSQN' | 'ISENTO' | 'IMUNE' | 'NAO_INCIDENCIA',
      clienteCpfCnpj,
      clienteNome,
      clienteEndereco,
      clienteEmail,
      clientId,
      serviceOrderId,
      saleId,
    };

    // Validate data
    const validation = validateNfseData(nfseData);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.errors.join('; ') },
        { status: 400 }
      );
    }

    // Calculate taxes
    const calculos = calculateIssqn(nfseData);

    // Generate sequential number if not provided
    let numero = nfseData.numero;
    if (!numero) {
      const lastNfse = await db.nfseServico.findFirst({
        where: { officeId, deleted: false },
        orderBy: { numero: 'desc' },
        select: { numero: true },
      });
      const lastNum = lastNfse ? parseInt(lastNfse.numero, 10) || 0 : 0;
      numero = String(lastNum + 1).padStart(6, '0');
    }

    // Check if number already exists for this office
    const existingNfse = await db.nfseServico.findFirst({
      where: { numero, officeId, deleted: false },
    });
    if (existingNfse) {
      return NextResponse.json(
        { success: false, error: `Número NFS-e ${numero} já existe para este escritório` },
        { status: 400 }
      );
    }

    // FISC-08: o código de verificação é emitido pelo município na autorização.
    // Gerá-lo aqui com Math.random() fabricava um documento que parecia oficial
    // (e ainda por cima previsível). Enquanto não houver transmissão, fica nulo.
    // Get office data for XML generation
    const office = await db.office.findUnique({
      where: { id: officeId },
      select: {
        cnpj: true,
        name: true,
        email: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        zipCode: true,
      },
    });

    if (!office) {
      return NextResponse.json(
        { success: false, error: 'Oficina não encontrada' },
        { status: 404 }
      );
    }

    // Generate XML
    const xmlContent = generateNfseXml({
      ...nfseData,
      ...calculos,
      numero,
      officeData: {
        cnpj: office.cnpj,
        name: office.name,
        email: office.email,
        phone: office.phone,
        address: office.address,
        city: office.city,
        state: office.state,
        zipCode: office.zipCode,
      },
    });

    // Create NFS-e record
    const nfse = await db.nfseServico.create({
      data: {
        numero,
        competencia: nfseData.competencia,
        tipoTributacao: nfseData.tipoTributacao,
        itemListaServico: nfseData.itemListaServico,
        discriminacao: nfseData.discriminacao,
        valorServicos: nfseData.valorServicos,
        valorDeducoes: nfseData.valorDeducoes,
        valorIssqn: calculos.valorIssqn,
        valorPis: calculos.valorPis,
        valorCofins: calculos.valorCofins,
        valorIr: calculos.valorIr,
        valorCsll: calculos.valorCsll,
        valorInss: calculos.valorInss,
        valorTotal: calculos.valorTotal,
        baseCalculo: calculos.baseCalculo,
        aliqIssqn: nfseData.aliqIssqn,
        clienteCpfCnpj: nfseData.clienteCpfCnpj || null,
        clienteNome: nfseData.clienteNome || null,
        clienteEndereco: nfseData.clienteEndereco || null,
        clienteEmail: nfseData.clienteEmail || null,
        xmlContent,
        // FISC-01: criado como RPS. Vira EMITIDA apenas por transmitNfse(), que
        // exige prova de autorização do município (protocolo + código).
        status: NFSE_RPS_STATUS,
        codigoVerificacao: null,
        officeId,
        clientId: nfseData.clientId || null,
        serviceOrderId: nfseData.serviceOrderId || null,
        saleId: nfseData.saleId || null,
      },
      include: {
        client: { select: { id: true, name: true, cpfCnpj: true } },
      },
    });

    // Audit log
    await auditLog({
      action: 'CREATE',
      entity: 'NfseServico',
      entityId: nfse.id,
      details: JSON.stringify({
        numero,
        valorServicos: nfseData.valorServicos,
        competencia: nfseData.competencia,
        status: NFSE_RPS_STATUS,
        aliqIssqn: nfseData.aliqIssqn,
        regimeFederalAssumido: calculos.regimeFederal,
      }),
      userId: auth.payload.userId,
      officeId,
    });

    // O que foi criado é um RPS: não é documento fiscal e não tem validade até
    // ser transmitido. Dizer isso na resposta é parte da correção.
    return NextResponse.json({
      success: true,
      transmitted: false,
      data: nfse,
      warning: `RPS ${numero} criado. Não é documento fiscal: transmita em POST /api/nfse/${nfse.id}/transmitir para obter autorização do município.`,
    }, { status: 201 });
  } catch (error) {
    const known = fiscalErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error creating NFS-e:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao criar NFS-e' },
      { status: 500 }
    );
  }
}
