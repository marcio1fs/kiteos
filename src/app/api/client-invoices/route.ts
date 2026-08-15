import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { generateNextNumber } from '@/lib/numbering';
import { logger } from '@/lib/logger';
import { generateChaveAcesso } from '@/lib/nfe/chave-generator';

// GET /api/client-invoices - List client invoices
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    // CINV-01 FIX: Add pagination parameters with defaults
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');
    const skip = (page - 1) * limit;

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

    const where: Record<string, any> = {
      officeId,
      deleted: false,
    };

    if (type) where.type = type;
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { number: { contains: search } },
        { destNome: { contains: search } },
        { destCpfCnpj: { contains: search } },
      ];
    }

    const [invoices, total] = await Promise.all([
      db.clientInvoice.findMany({
        where,
        include: {
          items: { where: { deleted: false }, orderBy: { createdAt: 'asc' } },
          sale: { select: { id: true, number: true } },
          serviceOrder: { select: { id: true, number: true } },
          client: { select: { id: true, name: true, cpfCnpj: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip, // CINV-01 FIX: Add pagination
        take: limit,
      }),
      db.clientInvoice.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: invoices,
      pagination: { // CINV-01 FIX: Return pagination metadata
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Error listing client invoices:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao listar notas fiscais de saída' },
      { status: 500 }
    );
  }
}

// POST /api/client-invoices - Generate a client invoice from a Sale or ServiceOrder
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, type, saleId, serviceOrderId } = body;

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

    if (!type || !['VENDA', 'SERVICO'].includes(type)) {
      return NextResponse.json(
        { success: false, error: 'Tipo inválido. Use VENDA ou SERVICO' },
        { status: 400 }
      );
    }

    if (type === 'VENDA' && !saleId) {
      return NextResponse.json(
        { success: false, error: 'saleId é obrigatório para NF de venda' },
        { status: 400 }
      );
    }

    if (type === 'SERVICO' && !serviceOrderId) {
      return NextResponse.json(
        { success: false, error: 'serviceOrderId é obrigatório para NF de serviço' },
        { status: 400 }
      );
    }

    // Check if an invoice already exists for this sale/OS
    if (saleId) {
      const existing = await db.clientInvoice.findFirst({
        where: { saleId, officeId, deleted: false },
      });
      if (existing) {
        // Return the existing invoice
        const fullInvoice = await db.clientInvoice.findUnique({
          where: { id: existing.id },
          include: {
            items: { where: { deleted: false }, orderBy: { createdAt: 'asc' } },
            sale: { select: { id: true, number: true } },
            serviceOrder: { select: { id: true, number: true } },
            client: { select: { id: true, name: true, cpfCnpj: true } },
          },
        });
        return NextResponse.json({
          success: true,
          data: fullInvoice,
          message: 'Nota fiscal já existente para esta venda',
        });
      }
    }

    if (serviceOrderId) {
      const existing = await db.clientInvoice.findFirst({
        where: { serviceOrderId, officeId, deleted: false },
      });
      if (existing) {
        const fullInvoice = await db.clientInvoice.findUnique({
          where: { id: existing.id },
          include: {
            items: { where: { deleted: false }, orderBy: { createdAt: 'asc' } },
            sale: { select: { id: true, number: true } },
            serviceOrder: { select: { id: true, number: true } },
            client: { select: { id: true, name: true, cpfCnpj: true } },
          },
        });
        return NextResponse.json({
          success: true,
          data: fullInvoice,
          message: 'Nota fiscal já existente para esta OS',
        });
      }
    }

    // Get office info for tax calculation (state)
    const office = await db.office.findUnique({ where: { id: officeId } });
    const officeState = office?.state || 'BA';

    // Generate sequential number — AUD-02 FIX: scoped to this office
    const number = await generateNextNumber('clientInvoice', officeId);

    if (type === 'VENDA' && saleId) {
      // Generate from Sale
      const sale = await db.sale.findUnique({
        where: { id: saleId },
        include: {
          client: true,
          items: { where: { deleted: false } },
        },
      });

      if (!sale || sale.officeId !== officeId || sale.deleted) {
        return NextResponse.json(
          { success: false, error: 'Venda não encontrada' },
          { status: 404 }
        );
      }

      if (sale.status !== 'PAGA') {
        return NextResponse.json(
          { success: false, error: 'Apenas vendas pagas podem gerar nota fiscal' },
          { status: 400 }
        );
      }

      // Build invoice items from sale items
      const invoiceItems: Array<{
        tipo: string;
        descricao: string;
        quantidade: number;
        unidade: string;
        valorUnitario: number;
        valorTotal: number;
        ncm: string | null;
        cfop: string | null;
        cst: string | null;
        csosn: string | null;
        baseIcms: number;
        valorIcms: number;
        valorIpi: number;
        valorPis: number;
        valorCofins: number;
        partId: string | null;
        officeId: string;
      }> = [];
      let totalBaseIcms = 0;
      let totalValorIcms = 0;
      let totalValorIpi = 0;
      let totalValorPis = 0;
      let totalValorCofins = 0;

      for (const item of sale.items) {
        // Get part info for tax data
        const part = item.partId ? await db.part.findUnique({ where: { id: item.partId } }) : null;

        const ncm = part?.ncm || null;
        const cfop = part?.cfop || null;
        const cst = part?.cst || null;
        const csosn = part?.csosn || null;

        // Look up tax rates
        let aliqIcms = 0;
        let aliqIpi = 0;
        let aliqPis = 0;
        let aliqCofins = 0;

        if (ncm && cfop) {
          // SEC-01 FIX: Scope tax rule lookup by officeId to prevent cross-tenant data leak
          const taxRule = await db.taxRule.findFirst({
            where: { ncm, cfop, state: officeState, active: true, officeId },
          });
          if (taxRule) {
            aliqIcms = Number(taxRule.aliqIcms);
            aliqIpi = Number(taxRule.aliqIpi);
            aliqPis = Number(taxRule.aliqPis);
            aliqCofins = Number(taxRule.aliqCofins);
          }
        }

        const valorTotal = Number(item.totalPrice);
        const baseIcms = valorTotal;
        const valorIcms = baseIcms * (aliqIcms / 100);
        const valorIpi = valorTotal * (aliqIpi / 100);
        const valorPis = valorTotal * (aliqPis / 100);
        const valorCofins = valorTotal * (aliqCofins / 100);

        totalBaseIcms += baseIcms;
        totalValorIcms += valorIcms;
        totalValorIpi += valorIpi;
        totalValorPis += valorPis;
        totalValorCofins += valorCofins;

        invoiceItems.push({
          tipo: 'PRODUTO',
          descricao: item.description,
          quantidade: Number(item.quantity),
          unidade: 'UN',
          valorUnitario: Number(item.unitPrice),
          valorTotal,
          ncm,
          cfop,
          cst,
          csosn,
          baseIcms,
          valorIcms,
          valorIpi,
          valorPis,
          valorCofins,
          partId: item.partId || null,
          officeId,
        });
      }

      const client = sale.client;

      const chave = generateChaveAcesso({
        uf: office?.state,
        dataEmissao: new Date(),
        cnpjEmitente: office?.cnpj || '',
        modelo: '55',
        serie: '1',
        numero: number,
      });

      const invoice = await db.clientInvoice.create({
        data: {
          number,
          chave,
          serie: '1',
          type: 'VENDA',
          status: 'EMITIDA',
          destNome: client?.name || 'Consumidor',
          destCpfCnpj: client?.cpfCnpj || null,
          destEndereco: client?.address || null,
          destCidade: client?.city || null,
          destEstado: client?.state || null,
          destCep: client?.zipCode || null,
          destTelefone: client?.phone || null,
          destEmail: client?.email || null,
          subtotal: sale.items.reduce((s, i) => s + Number(i.totalPrice), 0),
          desconto: Number(sale.discount),
          totalAmount: Number(sale.totalAmount),
          baseIcms: totalBaseIcms,
          valorIcms: totalValorIcms,
          valorIpi: totalValorIpi,
          valorPis: totalValorPis,
          valorCofins: totalValorCofins,
          observacao: sale.obs || null,
          saleId: sale.id,
          officeId,
          clientId: client?.id || null,
          items: { create: invoiceItems },
        },
        include: {
          items: { where: { deleted: false }, orderBy: { createdAt: 'asc' } },
          sale: { select: { id: true, number: true } },
          serviceOrder: { select: { id: true, number: true } },
          client: { select: { id: true, name: true, cpfCnpj: true } },
        },
      });

      return NextResponse.json({ success: true, data: invoice }, { status: 201 });
    }

    if (type === 'SERVICO' && serviceOrderId) {
      // Generate from Service Order
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

      if (os.status !== 'PAGA') {
        return NextResponse.json(
          { success: false, error: 'Apenas OS pagas podem gerar nota fiscal' },
          { status: 400 }
        );
      }

      // Build invoice items from OS items
      const invoiceItems: Array<{
        tipo: string;
        descricao: string;
        quantidade: number;
        unidade: string;
        valorUnitario: number;
        valorTotal: number;
        ncm: string | null;
        cfop: string | null;
        cst: string | null;
        csosn: string | null;
        baseIcms: number;
        valorIcms: number;
        valorIpi: number;
        valorPis: number;
        valorCofins: number;
        partId: string | null;
        officeId: string;
      }> = [];
      let totalBaseIcms = 0;
      let totalValorIcms = 0;
      let totalValorIpi = 0;
      let totalValorPis = 0;
      let totalValorCofins = 0;

      for (const item of os.items) {
        // Get part info for tax data (PECA items)
        const part = item.partId ? await db.part.findUnique({ where: { id: item.partId } }) : null;

        const ncm = part?.ncm || null;
        const cfop = part?.cfop || null;
        const cst = part?.cst || null;
        const csosn = part?.csosn || null;

        // Look up tax rates
        let aliqIcms = 0;
        let aliqIpi = 0;
        let aliqPis = 0;
        let aliqCofins = 0;

        if (ncm && cfop) {
          // SEC-01 FIX: Scope tax rule lookup by officeId to prevent cross-tenant data leak
          const taxRule = await db.taxRule.findFirst({
            where: { ncm, cfop, state: officeState, active: true, officeId },
          });
          if (taxRule) {
            aliqIcms = Number(taxRule.aliqIcms);
            aliqIpi = Number(taxRule.aliqIpi);
            aliqPis = Number(taxRule.aliqPis);
            aliqCofins = Number(taxRule.aliqCofins);
          }
        }

        const valorTotal = Number(item.totalPrice);
        const baseIcms = valorTotal;
        const valorIcms = baseIcms * (aliqIcms / 100);
        const valorIpi = valorTotal * (aliqIpi / 100);
        const valorPis = valorTotal * (aliqPis / 100);
        const valorCofins = valorTotal * (aliqCofins / 100);

        totalBaseIcms += baseIcms;
        totalValorIcms += valorIcms;
        totalValorIpi += valorIpi;
        totalValorPis += valorPis;
        totalValorCofins += valorCofins;

        invoiceItems.push({
          tipo: item.type === 'PECA' ? 'PRODUTO' : 'SERVICO',
          descricao: item.description,
          quantidade: Number(item.quantity),
          unidade: 'UN',
          valorUnitario: Number(item.unitPrice),
          valorTotal,
          ncm,
          cfop,
          cst,
          csosn,
          baseIcms,
          valorIcms,
          valorIpi,
          valorPis,
          valorCofins,
          partId: item.partId || null,
          officeId,
        });
      }

      const client = os.client;

      const chave = generateChaveAcesso({
        uf: office?.state,
        dataEmissao: new Date(),
        cnpjEmitente: office?.cnpj || '',
        modelo: '55',
        serie: '1',
        numero: number,
      });

      const invoice = await db.clientInvoice.create({
        data: {
          number,
          chave,
          serie: '1',
          type: 'SERVICO',
          status: 'EMITIDA',
          destNome: client.name,
          destCpfCnpj: client.cpfCnpj || null,
          destEndereco: client.address || null,
          destCidade: client.city || null,
          destEstado: client.state || null,
          destCep: client.zipCode || null,
          destTelefone: client.phone || null,
          destEmail: client.email || null,
          veiculoPlaca: os.vehicle.plate,
          veiculoModelo: [os.vehicle.brand, os.vehicle.model].filter(Boolean).join(' ') || null,
          veiculoAno: os.vehicle.year,
          veiculoCor: os.vehicle.color,
          subtotal: Number(os.totalParts) + Number(os.totalServices),
          desconto: Number(os.totalDiscount),
          totalAmount: Number(os.totalAmount),
          baseIcms: totalBaseIcms,
          valorIcms: totalValorIcms,
          valorIpi: totalValorIpi,
          valorPis: totalValorPis,
          valorCofins: totalValorCofins,
          observacao: os.description || null,
          serviceOrderId: os.id,
          officeId,
          clientId: client.id,
          items: { create: invoiceItems },
        },
        include: {
          items: { where: { deleted: false }, orderBy: { createdAt: 'asc' } },
          sale: { select: { id: true, number: true } },
          serviceOrder: { select: { id: true, number: true } },
          client: { select: { id: true, name: true, cpfCnpj: true } },
        },
      });

      return NextResponse.json({ success: true, data: invoice }, { status: 201 });
    }

    return NextResponse.json(
      { success: false, error: 'Dados insuficientes para gerar nota fiscal' },
      { status: 400 }
    );
  } catch (error) {
    logger.error('Error creating client invoice:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao gerar nota fiscal' },
      { status: 500 }
    );
  }
}
