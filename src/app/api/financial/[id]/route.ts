import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// GET /api/financial/[id] - Get financial entry by id
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { id } = await params;

    const entry = await db.financialEntry.findFirst({
      where: {
        id,
        deleted: false,
      },
      include: {
        supplier: {
          select: {
            id: true,
            razaoSocial: true,
            nomeFantasia: true,
            cnpj: true,
          },
        },
        office: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Entrada financeira não encontrada' },
        { status: 404 }
      );
    }

    if (entry.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Auto-check if overdue
    const now = new Date();
    if (entry.status === 'PENDENTE' && entry.dueDate < now) {
      const updated = await db.financialEntry.update({
        where: { id: entry.id },
        data: { status: 'ATRASADO' },
        include: {
          supplier: {
            select: {
              id: true,
              razaoSocial: true,
              nomeFantasia: true,
              cnpj: true,
            },
          },
          office: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      return NextResponse.json({
        success: true,
        data: updated,
      });
    }

    return NextResponse.json({
      success: true,
      data: entry,
    });
  } catch (error) {
    console.error('Error getting financial entry:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar entrada financeira' },
      { status: 500 }
    );
  }
}

// PUT /api/financial/[id] - Update financial entry
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { id } = await params;
    const body = await request.json();

    // Check if entry exists and is not deleted
    const existing = await db.financialEntry.findFirst({
      where: { id, deleted: false },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Entrada financeira não encontrada' },
        { status: 404 }
      );
    }

    if (existing.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Don't allow editing paid entries
    if (existing.status === 'PAGO') {
      return NextResponse.json(
        { success: false, error: 'Não é possível editar uma entrada já paga' },
        { status: 400 }
      );
    }

    const {
      type,
      category,
      description,
      amount,
      discount,
      interest,
      dueDate,
      paymentMethod,
      reference,
      supplierId,
      status,
    } = body;

    // Validate amount if provided
    if (amount !== undefined && amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'amount deve ser maior que zero' },
        { status: 400 }
      );
    }

    if (discount !== undefined && discount < 0) {
      return NextResponse.json(
        { success: false, error: 'discount não pode ser negativo' },
        { status: 400 }
      );
    }

    if (interest !== undefined && interest < 0) {
      return NextResponse.json(
        { success: false, error: 'interest não pode ser negativo' },
        { status: 400 }
      );
    }

    // Calculate totalAmount with updated values
    const newAmount = amount !== undefined ? amount : existing.amount;
    const newDiscount = discount !== undefined ? discount : existing.discount;
    const newInterest = interest !== undefined ? interest : existing.interest;
    const totalAmount = newAmount - newDiscount + newInterest;

    // Auto-set status based on dueDate
    const now = new Date();
    const newDueDate = dueDate ? new Date(dueDate) : existing.dueDate;
    let newStatus: string = status || existing.status;

    // AUD-H02 FIX: Block direct PAGO/CANCELADO status changes via PUT
    // Payment approval must go through /api/financial/pay/[id] (ADMIN/OWNER only)
    // Cancellation must go through DELETE endpoint
    if (status === 'PAGO') {
      return NextResponse.json(
        { success: false, error: 'Use o endpoint /api/financial/pay/[id] para aprovar pagamentos' },
        { status: 400 }
      );
    }
    if (status === 'CANCELADO') {
      return NextResponse.json(
        { success: false, error: 'Use o endpoint DELETE para cancelar entradas financeiras' },
        { status: 400 }
      );
    }

    if (newStatus === 'PENDENTE' && newDueDate < now) {
      newStatus = 'ATRASADO';
    } else if (newStatus === 'ATRASADO' && newDueDate >= now) {
      newStatus = 'PENDENTE';
    }

    const updateData: Record<string, unknown> = {
      totalAmount,
      status: newStatus,
    };

    if (type !== undefined) updateData.type = type;
    if (category !== undefined) updateData.category = category;
    if (description !== undefined) updateData.description = description;
    if (amount !== undefined) updateData.amount = amount;
    if (discount !== undefined) updateData.discount = discount;
    if (interest !== undefined) updateData.interest = interest;
    if (dueDate !== undefined) updateData.dueDate = new Date(dueDate);
    if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
    if (reference !== undefined) updateData.reference = reference;
    if (supplierId !== undefined) updateData.supplierId = supplierId || null;

    const entry = await db.financialEntry.update({
      where: { id },
      data: updateData,
      include: {
        supplier: {
          select: {
            id: true,
            razaoSocial: true,
            nomeFantasia: true,
            cnpj: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: entry,
    });
  } catch (error) {
    console.error('Error updating financial entry:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar entrada financeira' },
      { status: 500 }
    );
  }
}

// DELETE /api/financial/[id] - Soft delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { id } = await params;

    const existing = await db.financialEntry.findFirst({
      where: { id, deleted: false },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Entrada financeira não encontrada' },
        { status: 404 }
      );
    }

    if (existing.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    await db.financialEntry.update({
      where: { id },
      data: { deleted: true },
    });

    return NextResponse.json({
      success: true,
      data: { message: 'Entrada financeira removida com sucesso' },
    });
  } catch (error) {
    console.error('Error deleting financial entry:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao remover entrada financeira' },
      { status: 500 }
    );
  }
}
