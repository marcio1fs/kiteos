import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/auth';
import { calculateIssqn, validateNfseData, generateNfseXml, getCurrentCompetencia, SERVICOS_OFICINA } from '@/lib/nfse';
import { NFSE_CANCELLED_STATUS, NFSE_RPS_STATUS, fiscalErrorResponse } from '@/lib/fiscal/document-status';

// POST /api/nfse/from-os - Generate NFS-e from Service Order
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, serviceOrderId, aliqIssqn, itemListaServico } = body;

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

    if (!serviceOrderId) {
      return NextResponse.json(
        { success: false, error: 'serviceOrderId é obrigatório' },
        { status: 400 }
      );
    }

    // Check if NFS-e already exists for this OS
    // Qualquer documento vivo desta OS bloqueia novo RPS: com a criação passando
    // a gerar RPS, filtrar só por EMITIDA permitiria empilhar rascunhos da mesma OS.
    const existingNfse = await db.nfseServico.findFirst({
      where: { serviceOrderId, officeId, deleted: false, status: { not: NFSE_CANCELLED_STATUS } },
    });
    if (existingNfse) {
      return NextResponse.json(
        {
          success: false,
          error: existingNfse.status === NFSE_RPS_STATUS
            ? `Já existe um RPS (${existingNfse.numero}) para esta ordem de serviço. Transmita-o ou cancele-o antes de gerar outro.`
            : 'Já existe uma NFS-e emitida para esta ordem de serviço',
          existingId: existingNfse.id,
          existingStatus: existingNfse.status,
        },
        { status: 400 }
      );
    }

    // Get Service Order with items and client
    const os = await db.serviceOrder.findUnique({
      where: { id: serviceOrderId },
      include: {
        client: true,
        vehicle: true,
        items: { where: { deleted: false } },
      },
    });

    if (!os || os.officeId !== officeId || os.deleted) {
      return NextResponse.json(
        { success: false, error: 'Ordem de serviço não encontrada' },
        { status: 404 }
      );
    }

    if (os.status !== 'PAGA' && os.status !== 'FINALIZADA') {
      return NextResponse.json(
        { success: false, error: 'Apenas OS pagas ou finalizadas podem gerar NFS-e' },
        { status: 400 }
      );
    }

    // Separate items by type
    const servicoItems = os.items.filter(i => i.type === 'SERVICO');
    const pecaItems = os.items.filter(i => i.type === 'PECA');

    // NFS-e is strictly for services — block if no services present
    if (servicoItems.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Esta Ordem de Serviço não possui serviços/mão de obra cadastrados. A NFS-e é exclusiva para serviços. Para peças, utilize a emissão de NF-e/NFC-e.',
        },
        { status: 400 }
      );
    }

    // Calculate totals for services and parts separately
    const rawTotalServicos = servicoItems.reduce((acc, item) => acc + Number(item.totalPrice), 0);
    const rawTotalPecas = pecaItems.reduce((acc, item) => acc + Number(item.totalPrice), 0);
    const rawTotalOS = rawTotalServicos + rawTotalPecas;

    // Apply proportional discount to services if OS has discount
    let descontoServicos = 0;
    const totalDiscountOS = Number(os.totalDiscount) || 0;
    if (totalDiscountOS > 0 && rawTotalOS > 0) {
      descontoServicos = Number(((totalDiscountOS * rawTotalServicos) / rawTotalOS).toFixed(2));
    }

    const valorServicosFinal = Math.max(0, Number((rawTotalServicos - descontoServicos).toFixed(2)));

    // Build discriminacao focusing exclusively on services
    const servicosDesc = servicoItems.map(
      i => `${i.description} (Qtd: ${Number(i.quantity)}, Valor: R$ ${Number(i.totalPrice).toFixed(2)})`
    );

    let discriminacao = `OS: ${os.number}`;
    if (os.description) discriminacao += ` - ${os.description}`;
    if (os.vehicle) discriminacao += `\nVeículo: ${os.vehicle.plate} - ${[os.vehicle.brand, os.vehicle.model].filter(Boolean).join(' ')}`;
    discriminacao += `\n\nServiços Prestados:\n${servicosDesc.join('\n')}`;
    if (descontoServicos > 0) {
      discriminacao += `\nDesconto nos Serviços: R$ ${descontoServicos.toFixed(2)}`;
    }
    if (pecaItems.length > 0) {
      discriminacao += `\n\n(Obs: Peças/materiais no valor total de R$ ${rawTotalPecas.toFixed(2)} devem ser faturados separadamente via NF-e/NFC-e para tributação de ICMS).`;
    }

    // Determine service item code - default to 14.01 (lubrication, washing, maintenance)
    const serviceCode = itemListaServico || '14.01';

    // Validate service code
    if (!SERVICOS_OFICINA.some(s => s.codigo === serviceCode)) {
      return NextResponse.json(
        { success: false, error: `Código de serviço inválido: ${serviceCode}` },
        { status: 400 }
      );
    }

    // Build NFS-e data with ONLY service amount for ISSQN
    const nfseData = {
      numero: '',
      competencia: getCurrentCompetencia(),
      itemListaServico: serviceCode,
      discriminacao,
      valorServicos: valorServicosFinal,
      valorDeducoes: 0,
      // FISC-08: alíquota de ISS é municipal; sem valor informado não há default
      // seguro. NaN é recusado por validateNfseData com mensagem clara.
      aliqIssqn: aliqIssqn === undefined || aliqIssqn === null || aliqIssqn === ''
        ? Number.NaN
        : Number(aliqIssqn),
      tipoTributacao: 'ISSQN' as const,
      clienteCpfCnpj: os.client.cpfCnpj || undefined,
      clienteNome: os.client.name,
      clienteEndereco: os.client.address || undefined,
      clienteEmail: os.client.email || undefined,
      clientId: os.clientId,
      serviceOrderId: os.id,
    };

    // Validate
    const validation = validateNfseData(nfseData);
    if (!validation.valid) {
      return NextResponse.json(
        { success: false, error: validation.errors.join('; ') },
        { status: 400 }
      );
    }

    // Calculate taxes
    const calculos = calculateIssqn(nfseData);

    // Generate sequential number
    const lastNfse = await db.nfseServico.findFirst({
      where: { officeId, deleted: false },
      orderBy: { numero: 'desc' },
      select: { numero: true },
    });
    const lastNum = lastNfse ? parseInt(lastNfse.numero, 10) || 0 : 0;
    const numero = String(lastNum + 1).padStart(6, '0');

    // FISC-08: código de verificação é emitido pelo município na autorização.

    // Get office data
    const office = await db.office.findUnique({
      where: { id: officeId },
      select: {
        cnpj: true, name: true, email: true, phone: true,
        address: true, city: true, state: true, zipCode: true,
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
        codigoVerificacao: null,
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
        // FISC-01: RPS até a transmissão autorizada (ver transmitNfse).
        status: NFSE_RPS_STATUS,
        officeId,
        clientId: nfseData.clientId || null,
        serviceOrderId: os.id,
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
        fromServiceOrder: os.number,
        valorServicos: nfseData.valorServicos,
      }),
      userId: auth.payload.userId,
      officeId,
    });

    return NextResponse.json({
      success: true,
      transmitted: false,
      data: nfse,
      warning: `RPS ${numero} criado a partir da OS ${os.number}. Não é documento fiscal: transmita em POST /api/nfse/${nfse.id}/transmitir.`,
    }, { status: 201 });
  } catch (error) {
    const known = fiscalErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error generating NFS-e from OS:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao gerar NFS-e a partir da OS' },
      { status: 500 }
    );
  }
}
