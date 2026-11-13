import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { updateServiceOrder, updateOsSchema, returnOrderStock } from '@/lib/service-orders';
import { commercialErrorResponse, CommercialError } from '@/lib/commercial';

// GET /api/service-orders/[id] - Get service order with items, client, vehicle
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

    const serviceOrder = await db.serviceOrder.findFirst({
      where: { id, officeId: auth.payload.officeId, deleted: false },
      include: {
        client: true,
        vehicle: true,
        items: {
          where: { deleted: false },
          include: {
            mechanic: {
              select: { id: true, name: true, commissionPct: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        notifications: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!serviceOrder) {
      return NextResponse.json(
        { success: false, error: 'Ordem de serviço não encontrada' },
        { status: 404 }
      );
    }

    if (serviceOrder.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    return NextResponse.json({ success: true, data: serviceOrder });
  } catch (error) {
    logger.error('Error getting service order:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar ordem de serviço' },
      { status: 500 }
    );
  }
}

// PUT /api/service-orders/[id] - Update service order
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
    const input = updateOsSchema.parse(await request.json());
    const result = await updateServiceOrder(id, auth.payload.officeId, input, auth.payload.userId);
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const known = commercialErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error updating service order:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao atualizar ordem de serviço' }, { status: 500 });
  }
}

// DELETE /api/service-orders/[id] - Soft delete unpaid order and return stock once
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
    await db.$transaction(async (tx) => {
      const existing = await tx.serviceOrder.findFirst({ where: { id, officeId, deleted: false }, include: { items: { where: { deleted: false } } } });
      if (!existing) throw new CommercialError('Ordem de serviço não encontrada', 404);
      if (existing.status === 'PAGA') throw new CommercialError('Não é possível excluir uma OS já paga', 409);
      if (existing.status === 'CANCELADA') throw new CommercialError('OS já cancelada', 409);
      const claimed = await tx.serviceOrder.updateMany({
        where: { id, officeId, deleted: false, version: existing.version, status: { notIn: ['PAGA', 'CANCELADA'] } },
        data: { deleted: true, status: 'CANCELADA', version: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new CommercialError('OS alterada por outra operação. Recarregue e tente novamente.', 409);
      await returnOrderStock(tx, existing, 'Estorno - Ordem de Serviço excluída');
      await tx.serviceOrderItem.updateMany({ where: { serviceOrderId: id, officeId }, data: { deleted: true } });
      await tx.auditLog.create({
        data: { action: 'DELETE', entity: 'ServiceOrder', entityId: id, details: JSON.stringify({ number: existing.number, previousStatus: existing.status }), userId: auth.payload.userId, officeId },
      });
    });
    return NextResponse.json({ success: true, data: { id, deleted: true } });
  } catch (error) {
    const known = commercialErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error deleting service order:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao excluir ordem de serviço' }, { status: 500 });
  }
}
