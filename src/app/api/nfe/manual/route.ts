import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { isValidCNPJ, isValidNCM, isValidCFOP } from '@/lib/server-validators';
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      officeId,
      userId,
      chave,
      numero,
      serie,
      dataEmissao,
      tipoOperacao,
      frete,
      seguro,
      desconto,
      observacao,
      supplierId,
      supplierCnpj,
      supplierRazaoSocial,
      items,
    } = body;

    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate required fields
    if (!officeId) errors.push('officeId é obrigatório');
    if (!numero) errors.push('numero é obrigatório');
    if (!serie) errors.push('serie é obrigatório');
    if (!dataEmissao) errors.push('dataEmissao é obrigatório');
    if (!items || !Array.isArray(items) || items.length === 0) errors.push('items é obrigatório e deve ter pelo menos um item');

    if (errors.length > 0) {
      return NextResponse.json({ success: false, errors }, { status: 400 });
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }

    // AUD-H01 FIX: Use authenticated user's ID instead of body parameter
    const authenticatedUserId = auth.payload.userId;

    // Need either supplierId or supplierCnpj+razaoSocial
    if (!supplierId && (!supplierCnpj || !supplierRazaoSocial)) {
      errors.push('Forneça supplierId ou supplierCnpj + supplierRazaoSocial');
    }

    // Validate supplier CNPJ if provided
    if (supplierCnpj && !isValidCNPJ(supplierCnpj)) {
      errors.push('CNPJ do fornecedor inválido');
    }

    if (errors.length > 0) {
      return NextResponse.json({ success: false, errors }, { status: 400 });
    }

    // Validate items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.descricao) errors.push(`Item ${i + 1}: descricao é obrigatório`);
      if (!item.ncm) errors.push(`Item ${i + 1}: ncm é obrigatório`);
      if (!item.cfop) errors.push(`Item ${i + 1}: cfop é obrigatório (CFOP é obrigatório para cada item)`);
      if (item.ncm && !isValidNCM(item.ncm)) errors.push(`Item ${i + 1}: NCM deve ter 8 dígitos`);
      if (item.cfop && !isValidCFOP(item.cfop)) errors.push(`Item ${i + 1}: CFOP deve ter 4 dígitos e começar com 1-7`);
      if (!item.quantidade || item.quantidade <= 0) errors.push(`Item ${i + 1}: quantidade deve ser maior que zero`);
      if (!item.valorUnitario || item.valorUnitario <= 0) errors.push(`Item ${i + 1}: valorUnitario deve ser maior que zero`);
    }

    if (errors.length > 0) {
      return NextResponse.json({ success: false, errors }, { status: 400 });
    }

    // Generate or validate chave
    const finalChave = chave || `MANUAL-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    // Check for duplicate chave + supplier
    if (chave) {
      const existingInvoice = await db.invoice.findFirst({
        where: {
          chave,
          officeId,
          deleted: false,
        },
      });
      if (existingInvoice) {
        return NextResponse.json(
          { success: false, errors: ['NF-e com esta chave já existe neste escritório'] },
          { status: 409 }
        );
      }
    }

    // Find or create supplier
    let supplier;
    if (supplierId) {
      supplier = await db.supplier.findFirst({
        where: { id: supplierId, officeId, deleted: false },
      });
      if (!supplier) {
        return NextResponse.json(
          { success: false, errors: ['Fornecedor não encontrado'] },
          { status: 404 }
        );
      }
    } else {
      supplier = await db.supplier.findFirst({
        where: { cnpj: supplierCnpj, officeId, deleted: false },
      });
      if (!supplier) {
        supplier = await db.supplier.create({
          data: {
            cnpj: supplierCnpj,
            razaoSocial: supplierRazaoSocial,
            officeId,
          },
        });
      }
    }

    // Calculate totals from items
    const subtotal = items.reduce((sum: number, item: { valorTotal: number }) => sum + item.valorTotal, 0);
    const totalBaseIcms = items.reduce((sum: number, item: { baseIcms?: number }) => sum + (item.baseIcms || 0), 0);
    const totalValorIcms = items.reduce((sum: number, item: { valorIcms?: number }) => sum + (item.valorIcms || 0), 0);
    const totalValorIpi = items.reduce((sum: number, item: { valorIpi?: number }) => sum + (item.valorIpi || 0), 0);
    const totalValorPis = items.reduce((sum: number, item: { valorPis?: number }) => sum + (item.valorPis || 0), 0);
    const totalValorCofins = items.reduce((sum: number, item: { valorCofins?: number }) => sum + (item.valorCofins || 0), 0);

    const freteValue = frete || 0;
    const seguroValue = seguro || 0;
    const descontoValue = desconto || 0;
    const totalNf = subtotal + freteValue + seguroValue - descontoValue + totalValorIpi;

    // Look up tax rules for items
    for (const item of items) {
      if (item.ncm && item.cfop) {
        // AUD-H01 FIX: Scope tax rule lookup by officeId
        const taxRule = await db.taxRule.findFirst({
          where: {
            ncm: item.ncm,
            cfop: item.cfop,
            active: true,
            officeId,
          },
        });
        if (!taxRule) {
          warnings.push(
            `Item "${item.descricao}" (NCM: ${item.ncm}, CFOP: ${item.cfop}): regra fiscal não encontrada`
          );
        }
      }
    }

    // Create Invoice with Items
    const invoice = await db.invoice.create({
      data: {
        chave: finalChave,
        numero,
        serie,
        tipoOperacao: tipoOperacao || 'ENTRADA',
        dataEmissao: new Date(dataEmissao),
        dataEntrada: new Date(),
        subtotal,
        frete: freteValue,
        seguro: seguroValue,
        desconto: descontoValue,
        baseIcms: totalBaseIcms,
        valorIcms: totalValorIcms,
        valorIpi: totalValorIpi,
        valorPis: totalValorPis,
        valorCofins: totalValorCofins,
        totalNf,
        status: 'IMPORTADA',
        observacao: observacao || null,
        supplierId: supplier.id,
        officeId,
        items: {
          create: items.map((item: {
            partId?: string;
            sku?: string;
            descricao: string;
            ncm: string;
            cfop: string;
            cst?: string;
            csosn?: string;
            quantidade: number;
            unidade?: string;
            valorUnitario: number;
            valorTotal: number;
            baseIcms?: number;
            valorIcms?: number;
            valorIpi?: number;
            valorPis?: number;
            valorCofins?: number;
            lote?: string;
            localizacao?: string;
          }) => ({
            partId: item.partId || null,
            sku: item.sku || null,
            descricao: item.descricao,
            ncm: item.ncm,
            cfop: item.cfop,
            cst: item.cst || null,
            csosn: item.csosn || null,
            quantidade: item.quantidade,
            unidade: item.unidade || 'UN',
            valorUnitario: item.valorUnitario,
            valorTotal: item.valorTotal,
            baseIcms: item.baseIcms || 0,
            valorIcms: item.valorIcms || 0,
            valorIpi: item.valorIpi || 0,
            valorPis: item.valorPis || 0,
            valorCofins: item.valorCofins || 0,
            lote: item.lote || null,
            localizacao: item.localizacao || null,
            officeId,
          })),
        },
      },
      include: {
        items: true,
        supplier: true,
      },
    });

    // Create Reception (PENDENTE)
    await db.reception.create({
      data: {
        status: 'PENDENTE',
        invoiceId: invoice.id,
        officeId,
      },
    });

    // Create audit log
    await createAuditLog({
      action: 'CREATE',
      entity: 'Invoice',
      entityId: invoice.id,
      details: JSON.stringify({
        method: 'MANUAL',
        chave: finalChave,
        numero,
        supplierId: supplier.id,
        totalNf,
        itemCount: items.length,
      }),
      userId: authenticatedUserId,
      officeId,
      invoiceId: invoice.id,
    });

    return NextResponse.json({
      success: true,
      data: invoice,
      warnings: warnings.length > 0 ? warnings : undefined,
    }, { status: 201 });

  } catch (error) {
    logger.error('Error creating manual NF-e:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        success: false,
        errors: ['Erro interno ao criar NF-e manual', error instanceof Error ? error.message : 'Erro desconhecido'],
      },
      { status: 500 }
    );
  }
}
