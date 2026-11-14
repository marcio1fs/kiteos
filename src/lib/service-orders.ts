import { z } from 'zod';
import { db } from '@/lib/db';
import { CommercialError, adjustStock, idSchema, moneySchema, quantitySchema, paymentMethodSchema, toCents, fromCents, type Tx } from '@/lib/commercial';
import type { Prisma } from '@prisma/client';

export const osItemSchema = z.object({
  id: idSchema.optional(),
  type: z.enum(['PECA', 'SERVICO']),
  description: z.string().trim().min(1).max(500),
  quantity: quantitySchema,
  unitPrice: moneySchema,
  partId: idSchema.nullish(),
  mechanicId: idSchema.nullish(),
  commissionPct: z.number().finite().min(0).max(100).optional(),
}).superRefine((item, ctx) => {
  if (item.type === 'PECA' && !item.partId) ctx.addIssue({ code: 'custom', message: 'Item PECA requer partId', path: ['partId'] });
  if (item.type === 'SERVICO' && item.partId) ctx.addIssue({ code: 'custom', message: 'Item SERVICO não deve ter partId', path: ['partId'] });
});

export const updateOsSchema = z.object({
  description: z.string().max(2000).nullish(),
  diagnosis: z.string().max(5000).nullish(),
  totalDiscount: moneySchema.optional(),
  paymentMethod: paymentMethodSchema.nullish(),
  items: z.array(osItemSchema).min(1).max(200).optional(),
}).strict();

type OSWithItems = Prisma.ServiceOrderGetPayload<{ include: { items: true } }>;

function itemCents(item: { quantity: number; unitPrice: number }) {
  return Math.round(toCents(item.unitPrice) * item.quantity);
}

async function validateReferences(tx: Tx, officeId: string, items: z.infer<typeof osItemSchema>[]) {
  for (const item of items) {
    if (item.partId) {
      const part = await tx.part.findFirst({ where: { id: item.partId, officeId, deleted: false } });
      if (!part) throw new CommercialError(`Peça não encontrada nesta oficina: ${item.partId}`, 404);
    }
    if (item.type === 'SERVICO' && item.mechanicId) {
      const mechanic = await tx.mechanic.findFirst({ where: { id: item.mechanicId, officeId, active: true, deleted: false } });
      if (!mechanic) throw new CommercialError(`Mecânico não encontrado nesta oficina: ${item.mechanicId}`, 404);
    }
  }
}

/** Claim the order with an optimistic-lock CAS before touching items/stock. */
async function claimOrder(tx: Tx, id: string, officeId: string, version: number) {
  const claimed = await tx.serviceOrder.updateMany({
    where: { id, officeId, version, deleted: false, status: { notIn: ['PAGA', 'CANCELADA'] } },
    data: { version: { increment: 1 } },
  });
  if (claimed.count !== 1) throw new CommercialError('OS alterada por outra operação ou já finalizada. Recarregue e tente novamente.', 409);
}

export async function updateServiceOrder(id: string, officeId: string, input: z.infer<typeof updateOsSchema>, actorId: string) {
  return db.$transaction(async (tx) => {
    const existing = await tx.serviceOrder.findFirst({ where: { id, officeId, deleted: false }, include: { items: { where: { deleted: false } } } });
    if (!existing) throw new CommercialError('Ordem de serviço não encontrada', 404);
    if (existing.status === 'PAGA' || existing.status === 'CANCELADA') throw new CommercialError(`Não é possível alterar uma OS ${existing.status}`, 409);

    await claimOrder(tx, id, officeId, existing.version);
    // Re-read inside the transaction after the CAS so item diffs use current rows.
    const current = await tx.serviceOrder.findFirst({ where: { id, officeId }, include: { items: { where: { deleted: false } } } }) as OSWithItems;

    const updateData: Prisma.ServiceOrderUpdateInput = { version: { increment: 0 } };
    if (input.description !== undefined) updateData.description = input.description;
    if (input.diagnosis !== undefined) updateData.diagnosis = input.diagnosis;
    if (input.paymentMethod !== undefined) updateData.paymentMethod = input.paymentMethod;

    let totalPartsCents = toCents(Number(current.totalParts));
    let totalServicesCents = toCents(Number(current.totalServices));

    if (input.items) {
      await validateReferences(tx, officeId, input.items);
      const currentById = new Map(current.items.map(i => [i.id, i]));
      const seen = new Set<string>();
      for (const item of input.items) {
        if (!item.id) continue;
        const old = currentById.get(item.id);
        if (!old || old.officeId !== officeId || old.serviceOrderId !== id) {
          throw new CommercialError('Item não pertence a esta ordem de serviço', 404);
        }
        if (seen.has(item.id)) throw new CommercialError('Item duplicado na requisição', 400);
        seen.add(item.id);
      }
      const keep = new Set(input.items.filter(i => i.id).map(i => i.id!));
      const removed = current.items.filter(i => !keep.has(i.id));
      const toUpdate = input.items.filter(i => i.id);
      const toCreate = input.items.filter(i => !i.id);

      for (const old of removed) {
        const changed = await tx.serviceOrderItem.updateMany({ where: { id: old.id, serviceOrderId: id, officeId, deleted: false }, data: { deleted: true } });
        if (changed.count !== 1) throw new CommercialError('Item alterado por outra operação', 409);
        if (old.type === 'PECA' && old.partId) {
          await adjustStock(tx, { officeId, partId: old.partId, delta: Number(old.quantity), reason: 'Estorno - Item removido da OS', reference: `OS:${id}` });
        }
      }

      for (const item of toUpdate) {
        const old = currentById.get(item.id!)!;
        // Reverse the previous reservation before applying the new one. This
        // handles part changes, type changes and quantity changes uniformly.
        if (old.type === 'PECA' && old.partId) {
          await adjustStock(tx, { officeId, partId: old.partId, delta: Number(old.quantity), reason: 'Estorno - Alteração de item da OS', reference: `OS:${id}` });
        }
        if (item.type === 'PECA' && item.partId) {
          await adjustStock(tx, { officeId, partId: item.partId, delta: -item.quantity, reason: 'Baixa - Alteração de item da OS', reference: `OS:${id}` });
        }
        const total = itemCents(item);
        const commPct = item.type === 'SERVICO' && item.mechanicId ? (item.commissionPct ?? Number(old.commissionPct)) : 0;
        const changed = await tx.serviceOrderItem.updateMany({
          where: { id: item.id!, serviceOrderId: id, officeId, deleted: false },
          data: {
            type: item.type, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice,
            totalPrice: fromCents(total), partId: item.type === 'PECA' ? item.partId : null,
            mechanicId: item.type === 'SERVICO' ? (item.mechanicId || null) : null,
            commissionPct: commPct, commissionValue: fromCents(Math.round(total * commPct / 100)),
          },
        });
        if (changed.count !== 1) throw new CommercialError('Item alterado por outra operação', 409);
      }

      if (toCreate.length) {
        await tx.serviceOrderItem.createMany({
          data: toCreate.map(item => {
            const total = itemCents(item);
            const commPct = item.type === 'SERVICO' && item.mechanicId ? (item.commissionPct ?? 0) : 0;
            return {
              type: item.type, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice,
              totalPrice: fromCents(total), partId: item.type === 'PECA' ? item.partId : null,
              mechanicId: item.type === 'SERVICO' ? (item.mechanicId || null) : null,
              commissionPct: commPct, commissionValue: fromCents(Math.round(total * commPct / 100)),
              serviceOrderId: id, officeId,
            };
          }),
        });
        for (const item of toCreate) {
          if (item.type === 'PECA' && item.partId) {
            await adjustStock(tx, { officeId, partId: item.partId, delta: -item.quantity, reason: 'Baixa - Novo item adicionado à OS', reference: `OS:${id}` });
          }
        }
      }

      const finalItems = await tx.serviceOrderItem.findMany({ where: { serviceOrderId: id, officeId, deleted: false } });
      totalPartsCents = finalItems.filter(i => i.type === 'PECA').reduce((s, i) => s + toCents(Number(i.totalPrice)), 0);
      totalServicesCents = finalItems.filter(i => i.type === 'SERVICO').reduce((s, i) => s + toCents(Number(i.totalPrice)), 0);
      updateData.totalParts = fromCents(totalPartsCents);
      updateData.totalServices = fromCents(totalServicesCents);
    }

    const discountCents = toCents(input.totalDiscount ?? Number(existing.totalDiscount));
    if (discountCents > totalPartsCents + totalServicesCents) throw new CommercialError('Desconto não pode ser maior que o total da OS', 400);
    updateData.totalDiscount = fromCents(discountCents);
    updateData.totalAmount = fromCents(totalPartsCents + totalServicesCents - discountCents);

    await tx.serviceOrder.update({ where: { id }, data: updateData });
    await tx.auditLog.create({
      data: { action: 'UPDATE', entity: 'ServiceOrder', entityId: id, details: JSON.stringify({ number: existing.number }), userId: actorId, officeId },
    });
    return tx.serviceOrder.findFirst({
      where: { id, officeId },
      include: { client: true, vehicle: true, items: { where: { deleted: false }, include: { mechanic: { select: { id: true, name: true, commissionPct: true } } }, orderBy: { createdAt: 'asc' } } },
    });
  });
}

export async function returnOrderStock(tx: Tx, order: OSWithItems, reason: string) {
  for (const item of order.items) {
    if (item.type !== 'PECA' || !item.partId || item.deleted) continue;
    await adjustStock(tx, { officeId: order.officeId, partId: item.partId, delta: Number(item.quantity), reason, reference: `OS:${order.id}` });
  }
}
