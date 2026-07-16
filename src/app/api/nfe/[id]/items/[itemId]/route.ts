import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// PATCH /api/nfe/[id]/items/[itemId] - Update InvoiceItem (e.g., set partId for mapping)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> }
) {
  try {
    const { id: invoiceId, itemId } = await params;
    const body = await request.json();
    const { officeId, partId } = body;

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    // Verify the invoice belongs to this office
    const invoice = await db.invoice.findFirst({
      where: { id: invoiceId, officeId, deleted: false },
    });

    if (!invoice) {
      return NextResponse.json(
        { success: false, error: 'NF-e não encontrada' },
        { status: 404 }
      );
    }

    // Verify the item belongs to this invoice
    const item = await db.invoiceItem.findFirst({
      where: { id: itemId, invoiceId },
    });

    if (!item) {
      return NextResponse.json(
        { success: false, error: 'Item não encontrado nesta NF-e' },
        { status: 404 }
      );
    }

    // If partId provided, verify it exists and belongs to this office
    if (partId) {
      const part = await db.part.findFirst({
        where: { id: partId, officeId, deleted: false },
      });

      if (!part) {
        return NextResponse.json(
          { success: false, error: 'Peça não encontrada no estoque desta oficina' },
          { status: 404 }
        );
      }
    }

    // Update the item with the new partId
    const updatedItem = await db.invoiceItem.update({
      where: { id: itemId },
      data: { partId: partId || null },
    });

    return NextResponse.json({
      success: true,
      data: updatedItem,
    });
  } catch (error) {
    console.error('Error updating invoice item:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar item da NF-e' },
      { status: 500 }
    );
  }
}
