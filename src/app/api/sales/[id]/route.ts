import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { paySale, cancelSale, updateOpenSale, updateSaleSchema } from '@/lib/sales';
import { commercialErrorResponse, CommercialError } from '@/lib/commercial';

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
      where: { id, officeId: auth.payload.officeId, deleted: false },
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

// PUT /api/sales/[id] - Payment, cancellation or open-sale metadata update
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
    const input = updateSaleSchema.parse(await request.json());
    const officeId = auth.payload.officeId;

    if (input.status === 'PAGA') {
      if (!input.paymentMethod) throw new CommercialError('Forma de pagamento é obrigatória', 400);
      const sale = await paySale(id, officeId, input.paymentMethod, auth.payload.userId, input.discount);
      return NextResponse.json({ success: true, data: sale });
    }
    if (input.status === 'CANCELADA') {
      if (auth.payload.role === 'EMPLOYEE') throw new CommercialError('Apenas ADMIN/OWNER podem cancelar vendas', 403);
      const sale = await cancelSale(id, officeId, auth.payload.userId);
      return NextResponse.json({ success: true, data: sale });
    }
    if (input.paymentMethod !== undefined) throw new CommercialError('Forma de pagamento só pode ser definida ao pagar a venda', 400);
    const sale = await updateOpenSale(id, officeId, { discount: input.discount, obs: input.obs });
    return NextResponse.json({ success: true, data: sale });
  } catch (error) {
    const known = commercialErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error updating sale:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao atualizar venda' }, { status: 500 });
  }
}

// DELETE /api/sales/[id] - Only cancelled, unpaid sales may be hidden.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request, undefined, 'ADMIN');
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }
    const { id } = await params;
    const officeId = auth.payload.officeId;
    const result = await db.sale.updateMany({
      where: { id, officeId, deleted: false, status: 'CANCELADA' },
      data: { deleted: true },
    });
    if (result.count !== 1) {
      const exists = await db.sale.findFirst({ where: { id, officeId, deleted: false } });
      if (!exists) return NextResponse.json({ success: false, error: 'Venda não encontrada' }, { status: 404 });
      return NextResponse.json({ success: false, error: 'Somente vendas canceladas podem ser excluídas. Cancele a venda antes de excluí-la.' }, { status: 409 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error('Error deleting sale:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao excluir venda' }, { status: 500 });
  }
}
