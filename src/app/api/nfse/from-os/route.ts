import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/auth';
import { calculateIssqn, validateNfseData, generateNfseXml, getCurrentCompetencia, ALIQ_ISSQN_PADRAO, SERVICOS_OFICINA } from '@/lib/nfse';

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
    const existingNfse = await db.nfseServico.findFirst({
      where: { serviceOrderId, officeId, deleted: false, status: 'EMITIDA' },
    });
    if (existingNfse) {
      return NextResponse.json(
        { success: false, error: 'Já existe uma NFS-e emitida para esta ordem de serviço' },
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

    // Build discriminacao from OS items
    const servicos = os.items
      .filter(i => i.type === 'SERVICO')
      .map(i => `${i.description} (Qtd: ${Number(i.quantity)}, Valor: R$ ${Number(i.totalPrice).toFixed(2)})`);

    const pecas = os.items
      .filter(i => i.type === 'PECA')
      .map(i => `${i.description} (Qtd: ${Number(i.quantity)}, Valor: R$ ${Number(i.totalPrice).toFixed(2)})`);

    let discriminacao = `OS: ${os.number}`;
    if (os.description) discriminacao += ` - ${os.description}`;
    if (os.vehicle) discriminacao += `\nVeículo: ${os.vehicle.plate} - ${[os.vehicle.brand, os.vehicle.model].filter(Boolean).join(' ')}`;
    if (servicos.length > 0) discriminacao += `\n\nServiços:\n${servicos.join('\n')}`;
    if (pecas.length > 0) discriminacao += `\n\nPeças/Materiais:\n${pecas.join('\n')}`;
    if (Number(os.totalDiscount) > 0) discriminacao += `\n\nDesconto: R$ ${Number(os.totalDiscount).toFixed(2)}`;

    // Determine service item code - prefer SERVICO items, else default
    const hasServicoItems = os.items.some(i => i.type === 'SERVICO')
    const serviceCode = itemListaServico || (hasServicoItems ? '14.01' : '14.04');

    // Validate service code
    if (!SERVICOS_OFICINA.some(s => s.codigo === serviceCode)) {
      return NextResponse.json(
        { success: false, error: `Código de serviço inválido: ${serviceCode}` },
        { status: 400 }
      );
    }

    // Build NFS-e data
    const nfseData = {
      numero: '',
      competencia: getCurrentCompetencia(),
      itemListaServico: serviceCode,
      discriminacao,
      valorServicos: Number(os.totalAmount),
      valorDeducoes: Number(os.totalDiscount),
      aliqIssqn: Number(aliqIssqn) || ALIQ_ISSQN_PADRAO,
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

    // Generate verification code
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let codigoVerificacao = '';
    for (let i = 0; i < 8; i++) {
      codigoVerificacao += chars.charAt(Math.floor(Math.random() * chars.length));
    }

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
        codigoVerificacao,
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
        status: 'EMITIDA',
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

    return NextResponse.json({ success: true, data: nfse }, { status: 201 });
  } catch (error) {
    console.error('Error generating NFS-e from OS:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao gerar NFS-e a partir da OS' },
      { status: 500 }
    );
  }
}
