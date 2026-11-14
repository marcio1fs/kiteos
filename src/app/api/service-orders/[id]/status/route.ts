import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { CommercialError, commercialErrorResponse, paymentMethodSchema, toCents, fromCents } from '@/lib/commercial';
import { returnOrderStock } from '@/lib/service-orders';
import { z } from 'zod';

const VALID_TRANSITIONS: Record<string, string[]> = {
  ABERTA: ['EM_EXECUCAO', 'CANCELADA'],
  EM_EXECUCAO: ['FINALIZADA', 'CANCELADA'],
  FINALIZADA: ['PAGA', 'CANCELADA'],
  PAGA: [],
  CANCELADA: [],
};

const bodySchema = z.object({
  status: z.enum(['ABERTA', 'EM_EXECUCAO', 'FINALIZADA', 'PAGA', 'CANCELADA']),
  paymentMethod: paymentMethodSchema.nullish(),
}).strict();

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    const { id } = await params;
    const { status: newStatus, paymentMethod } = bodySchema.parse(await request.json());
    const officeId = auth.payload.officeId;

    const result = await db.$transaction(async (tx) => {
      const order = await tx.serviceOrder.findFirst({
        where: { id, officeId, deleted: false },
        include: { client: true, items: { where: { deleted: false } } },
      });
      if (!order) throw new CommercialError('Ordem de serviço não encontrada', 404);
      const allowed = VALID_TRANSITIONS[order.status] || [];
      if (!allowed.includes(newStatus)) {
        throw new CommercialError(`Transição de status inválida: ${order.status} → ${newStatus}`, 409);
      }
      if (newStatus === 'PAGA' && !paymentMethod && !order.paymentMethod) {
        throw new CommercialError('Forma de pagamento é obrigatória', 400);
      }
      if (newStatus === 'CANCELADA' && auth.payload.role === 'EMPLOYEE') {
        throw new CommercialError('Apenas ADMIN/OWNER podem cancelar OS', 403);
      }

      const claimed = await tx.serviceOrder.updateMany({
        where: { id, officeId, deleted: false, status: order.status, version: order.version },
        data: {
          status: newStatus,
          version: { increment: 1 },
          ...(newStatus === 'PAGA' ? { paidAt: new Date(), paymentMethod: paymentMethod || order.paymentMethod } : {}),
        },
      });
      if (claimed.count !== 1) throw new CommercialError('OS alterada por outra operação. Recarregue e tente novamente.', 409);

      if (newStatus === 'PAGA') {
        // totalAmount is already net of discount; gross is parts + services.
        const grossCents = toCents(Number(order.totalParts)) + toCents(Number(order.totalServices));
        const discountCents = toCents(Number(order.totalDiscount));
        const netCents = toCents(Number(order.totalAmount));
        if (netCents !== grossCents - discountCents) throw new CommercialError('Totais da OS inconsistentes. Revise a OS antes de pagar.', 409);
        await tx.financialEntry.create({
          data: {
            type: 'RECEBER', category: 'OS', description: `Recebimento OS ${order.number} - ${order.client.name}`,
            amount: fromCents(grossCents), discount: fromCents(discountCents), interest: 0, totalAmount: fromCents(netCents),
            status: 'PAGO', dueDate: new Date(), paymentDate: new Date(), paymentMethod: paymentMethod || order.paymentMethod,
            reference: `OS:${order.id}`, officeId,
          },
        });
      }

      if (newStatus === 'CANCELADA') {
        await returnOrderStock(tx, order, 'Estorno - Ordem de Serviço cancelada');
      }

      if (newStatus === 'FINALIZADA' && (order.client.phone || order.client.email)) {
        await tx.notification.create({
          data: {
            type: order.client.phone ? 'WHATSAPP' : 'EMAIL', template: 'OS_COMPLETED', title: 'Ordem de Serviço Finalizada',
            message: `Sua Ordem de Serviço ${order.number} foi finalizada e está pronta para retirada. Valor total: R$ ${Number(order.totalAmount).toFixed(2)}`,
            recipient: order.client.phone || order.client.email, status: 'PENDENTE', serviceOrderId: id, officeId,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          action: 'STATUS_CHANGE', entity: 'ServiceOrder', entityId: id,
          details: JSON.stringify({ number: order.number, fromStatus: order.status, toStatus: newStatus }),
          userId: auth.payload.userId, officeId,
        },
      });
      return tx.serviceOrder.findFirst({
        where: { id, officeId },
        include: {
          client: { select: { id: true, name: true, phone: true, email: true } },
          vehicle: { select: { id: true, plate: true, brand: true, model: true } },
          items: { where: { deleted: false }, orderBy: { createdAt: 'asc' } },
        },
      });
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const known = commercialErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    console.error('Error changing service order status:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'Erro ao alterar status da ordem de serviço' }, { status: 500 });
  }
}
