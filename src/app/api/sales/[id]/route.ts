import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// GET /api/sales/[id] - Get sale detail
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
    const sale = await db.sale.findFirst({
      where: { id, deleted: false },
      include: {
        client: {
          select: { id: true, name: true, phone: true, email: true, cpfCnpj: true },
        },
        items: {
          where: { deleted: false },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!sale) {
      return NextResponse.json(
        { success: false, error: 'Venda não encontrada' },
        { status: 404 }
      );
    }

    if (sale.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    return NextResponse.json({ success: true, data: sale });
  } catch (error) {
    logger.error('Error fetching sale:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar venda' },
      { status: 500 }
    );
  }
}

// PUT /api/sales/[id] - Update sale (status transition, payment)
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
    const { status, paymentMethod, discount, obs } = body;

    const sale = await db.sale.findFirst({
      where: { id, deleted: false },
      include: { items: { where: { deleted: false } } },
    });

    if (!sale) {
      return NextResponse.json(
        { success: false, error: 'Venda não encontrada' },
        { status: 404 }
      );
    }

    if (sale.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Handle payment (mark as PAGA)
    if (status === 'PAGA' && sale.status === 'ABERTA') {
      if (!paymentMethod) {
        return NextResponse.json(
          { success: false, error: 'Forma de pagamento é obrigatória' },
          { status: 400 }
        );
      }

      const updatedSale = await db.$transaction(async (tx) => {
        const updated = await tx.sale.update({
          where: { id },
          data: {
            status: 'PAGA',
            paymentMethod,
            paidAt: new Date(),
            discount: discount !== undefined ? discount : Number(sale.discount),
            totalAmount: sale.items.reduce((sum, i) => sum + Number(i.totalPrice), 0) - (discount !== undefined ? discount : Number(sale.discount)),
            obs: obs !== undefined ? obs : sale.obs,
          },
          include: {
            client: true,
            items: true,
          },
        });

        // Create financial entry
        await tx.financialEntry.create({
          data: {
            type: 'RECEBER',
            category: 'PDV',
            description: `Venda ${sale.number}`,
            amount: Number(updated.totalAmount),
            discount: 0,
            interest: 0,
            totalAmount: Number(updated.totalAmount),
            status: 'PAGO',
            dueDate: new Date(),
            paymentDate: new Date(),
            paymentMethod,
            reference: sale.number,
            saleId: sale.id,
            officeId: sale.officeId,
          },
        });

        return updated;
      });

      return NextResponse.json({ success: true, data: updatedSale });
    }

    // Handle cancellation
    if (status === 'CANCELADA' && (sale.status === 'ABERTA' || sale.status === 'PAGA')) {
      const updatedSale = await db.$transaction(async (tx) => {
        // Return stock for part items
        for (const item of sale.items) {
          if (item.partId) {
            const part = await tx.part.findFirst({
              where: { id: item.partId, deleted: false },
            });
            if (part) {
              // Create ENTRADA stock movement (return)
              await tx.stockMovement.create({
                data: {
                  type: 'ENTRADA',
                  quantity: Number(item.quantity),
                  unitCost: Number(part.costPrice),
                  reason: 'Cancelamento de venda PDV',
                  reference: sale.number,
                  partId: part.id,
                  officeId: sale.officeId,
                },
              });

              // Return stock
              await tx.part.update({
                where: { id: part.id },
                data: { quantity: Number(part.quantity) + Number(item.quantity) },
              });
            }
          }
        }

        // If was PAGA, cancel the financial entry
        if (sale.status === 'PAGA') {
          await tx.financialEntry.updateMany({
            where: { saleId: sale.id, deleted: false },
            data: { status: 'CANCELADO' },
          });
        }

        const updated = await tx.sale.update({
          where: { id },
          data: { status: 'CANCELADA' },
          include: {
            client: true,
            items: true,
          },
        });

        return updated;
      });

      return NextResponse.json({ success: true, data: updatedSale });
    }

    // Simple update (discount, obs)
    const updatedSale = await db.sale.update({
      where: { id },
      data: {
        discount: discount !== undefined ? discount : Number(sale.discount),
        obs: obs !== undefined ? obs : sale.obs,
        totalAmount: sale.items.reduce((sum, i) => sum + Number(i.totalPrice), 0) - (discount !== undefined ? discount : Number(sale.discount)),
      },
      include: {
        client: true,
        items: true,
      },
    });

    return NextResponse.json({ success: true, data: updatedSale });
  } catch (error) {
    logger.error('Error updating sale:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar venda' },
      { status: 500 }
    );
  }
}

// DELETE /api/sales/[id] - Soft delete sale
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

    const sale = await db.sale.findFirst({
      where: { id, deleted: false },
    });

    if (!sale) {
      return NextResponse.json(
        { success: false, error: 'Venda não encontrada' },
        { status: 404 }
      );
    }

    if (sale.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    await db.sale.update({
      where: { id },
      data: { deleted: true },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error deleting sale:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao excluir venda' },
      { status: 500 }
    );
  }
}
