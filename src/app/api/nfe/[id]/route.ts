import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // AUD-C01 FIX: Added requireAuth — was completely unauthenticated
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }

    const { id } = await params;

    const invoice = await db.invoice.findFirst({
      where: { id, officeId: auth.payload.officeId, deleted: false },
      include: {
        items: {
          where: { deleted: false },
          orderBy: { createdAt: 'asc' },
        },
        supplier: true,
        reception: true,
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!invoice) {
      return NextResponse.json(
        { success: false, errors: ['NF-e não encontrada'] },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: invoice,
    });

  } catch (error) {
    logger.error('Error fetching NF-e:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao buscar NF-e'] },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // AUD-C01 FIX: Added requireAuth — was completely unauthenticated
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }

    const { id } = await params;
    const body = await request.json();
    const { ...updateData } = body;
    const officeId = auth.payload.officeId;
    const userId = auth.payload.userId;

    // Find existing invoice
    const existingInvoice = await db.invoice.findFirst({
      where: { id, officeId, deleted: false },
    });

    if (!existingInvoice) {
      return NextResponse.json(
        { success: false, errors: ['NF-e não encontrada'] },
        { status: 404 }
      );
    }

    // Only allow update if status is IMPORTADA
    if (existingInvoice.status !== 'IMPORTADA') {
      return NextResponse.json(
        { success: false, errors: [`NF-e só pode ser alterada com status IMPORTADA. Status atual: ${existingInvoice.status}`] },
        { status: 400 }
      );
    }

    // Build update object with allowed fields
    const allowedFields = [
      'numero', 'serie', 'tipoOperacao', 'frete', 'seguro', 'desconto',
      'baseIcms', 'valorIcms', 'valorIpi', 'valorPis', 'valorCofins',
      'totalNf', 'observacao',
    ];

    const dataToUpdate: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (updateData[field] !== undefined) {
        dataToUpdate[field] = updateData[field];
      }
    }

    // Handle date fields
    if (updateData.dataEmissao) {
      dataToUpdate.dataEmissao = new Date(updateData.dataEmissao);
    }
    if (updateData.dataEntrada) {
      dataToUpdate.dataEntrada = new Date(updateData.dataEntrada);
    }

    // Recalculate subtotal if items are provided
    if (updateData.items && Array.isArray(updateData.items)) {
      const subtotal = updateData.items.reduce(
        (sum: number, item: { valorTotal: number }) => sum + item.valorTotal,
        0
      );
      dataToUpdate.subtotal = subtotal;
    }

    // Update invoice
    const updatedInvoice = await db.invoice.update({
      where: { id },
      data: dataToUpdate,
      include: {
        items: { where: { deleted: false } },
        supplier: true,
      },
    });

    // Update items if provided
    if (updateData.items && Array.isArray(updateData.items)) {
      // Delete existing items and recreate
      await db.invoiceItem.updateMany({
        where: { invoiceId: id },
        data: { deleted: true },
      });

      for (const item of updateData.items) {
        await db.invoiceItem.create({
          data: {
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
            invoiceId: id,
            officeId,
          },
        });
      }
    }

    // Create audit log
    await createAuditLog({
      action: 'UPDATE',
      entity: 'Invoice',
      entityId: id,
      details: JSON.stringify({
        updatedFields: Object.keys(dataToUpdate),
        previousStatus: existingInvoice.status,
      }),
      userId: userId || null,
      officeId,
      invoiceId: id,
    });

    // Re-fetch with updated items
    const finalInvoice = await db.invoice.findFirst({
      where: { id, deleted: false },
      include: {
        items: { where: { deleted: false } },
        supplier: true,
        reception: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: finalInvoice,
    });

  } catch (error) {
    logger.error('Error updating NF-e:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao atualizar NF-e'] },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // AUD-C01 FIX: Added requireAuth — was completely unauthenticated
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }

    const { id } = await params;
    const officeId = auth.payload.officeId;
    const userId = auth.payload.userId;

    const invoice = await db.invoice.findFirst({
      where: { id, officeId, deleted: false },
    });

    if (!invoice) {
      return NextResponse.json(
        { success: false, errors: ['NF-e não encontrada'] },
        { status: 404 }
      );
    }

    // Soft delete invoice
    await db.invoice.update({
      where: { id },
      data: { deleted: true },
    });

    // Soft delete items
    await db.invoiceItem.updateMany({
      where: { invoiceId: id },
      data: { deleted: true },
    });

    // Soft delete reception
    const reception = await db.reception.findFirst({
      where: { invoiceId: id, officeId, deleted: false },
    });
    if (reception) {
      await db.reception.update({
        where: { id: reception.id },
        data: { deleted: true },
      });
    }

    // Create audit log
    await createAuditLog({
      action: 'DELETE',
      entity: 'Invoice',
      entityId: id,
      details: JSON.stringify({
        chave: invoice.chave,
        numero: invoice.numero,
        totalNf: invoice.totalNf,
      }),
      userId: userId,
      officeId,
      invoiceId: id,
    });

    return NextResponse.json({
      success: true,
      data: { id, deleted: true },
    });

  } catch (error) {
    logger.error('Error deleting NF-e:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao excluir NF-e'] },
      { status: 500 }
    );
  }
}