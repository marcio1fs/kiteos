import { z } from 'zod';
import { db } from '@/lib/db';
import {
  CommercialError, adjustStock, idSchema, moneySchema, quantitySchema,
  paymentMethodSchema, toCents, fromCents, nextOfficeSequence, type Tx,
} from '@/lib/commercial';
import type { Prisma } from '@prisma/client';

const saleItemSchema = z.object({
  partId: idSchema.nullish(),
  description: z.string().trim().min(1).max(500),
  quantity: quantitySchema,
  unitPrice: moneySchema,
});

export const createSaleSchema = z.object({
  officeId: idSchema,
  clientId: idSchema.nullish(),
  sellerId: idSchema.nullish(),
  userId: idSchema.nullish(),
  discount: moneySchema.default(0),
  paymentMethod: paymentMethodSchema.nullish(),
  pendingPayment: z.boolean().default(false),
  obs: z.string().max(2000).nullish(),
  items: z.array(saleItemSchema).min(1).max(200),
});

export const updateSaleSchema = z.object({
  status: z.enum(['PAGA', 'CANCELADA']).optional(),
  paymentMethod: paymentMethodSchema.nullish(),
  discount: moneySchema.optional(),
  obs: z.string().max(2000).nullish(),
}).strict();

type SaleWithItems = Prisma.SaleGetPayload<{ include: { items: true } }>;

export function formatDocumentNumber(sequence: number): string {
  const letterIndex = Math.floor((sequence - 1) / 999);
  const within = ((sequence - 1) % 999) + 1;
  const letters = letterIndex < 26
    ? String.fromCharCode(65 + letterIndex)
    : String.fromCharCode(64 + Math.floor(letterIndex / 26)) + String.fromCharCode(65 + (letterIndex % 26));
  return `${letters}${String(within).padStart(3, '0')}`;
}

async function nextSaleNumber(tx: Tx, officeId: string): Promise<string> {
  // Seed a new per-office counter from existing documents so deployments that
  // predate the sequencer do not restart at A001. The unique(number, officeId)
  // constraint remains the final guard.
  const existing = await tx.sale.findMany({ where: { officeId }, select: { number: true } });
  let max = 0;
  for (const { number } of existing) {
    const m = /^([A-Z]{1,2})(\d{3})$/.exec(number);
    if (!m) continue;
    const letters = m[1];
    const index = letters.length === 1 ? letters.charCodeAt(0) - 65 : (letters.charCodeAt(0) - 64) * 26 + (letters.charCodeAt(1) - 65);
    max = Math.max(max, index * 999 + Number(m[2]));
  }
  const row = await tx.sequencer.upsert({
    where: { officeId_entity: { officeId, entity: 'SALE' } },
    create: { officeId, entity: 'SALE', currentValue: max + 1 },
    update: { currentValue: { increment: 1 } },
  });
  if (row.currentValue <= max) {
    // Counter existed but was behind legacy documents; jump ahead atomically.
    const bumped = await tx.sequencer.update({
      where: { officeId_entity: { officeId, entity: 'SALE' } },
      data: { currentValue: max + 1 },
    });
    return formatDocumentNumber(bumped.currentValue);
  }
  return formatDocumentNumber(row.currentValue);
}

/** Stock is reserved when the sale is created, including pending payments. */
async function deductSaleStock(tx: Tx, sale: SaleWithItems, reason: string) {
  for (const item of sale.items) {
    if (!item.partId || item.deleted) continue;
    await adjustStock(tx, {
      officeId: sale.officeId,
      partId: item.partId,
      delta: -Number(item.quantity),
      reason,
      reference: `SALE:${sale.id}`,
    });
  }
}

/** Legacy pending sales may not have reserved stock; reserve exactly once. */
async function ensureSaleStockDeducted(tx: Tx, sale: SaleWithItems) {
  const existing = await tx.stockMovement.findFirst({
    where: {
      officeId: sale.officeId,
      type: 'SAIDA',
      deleted: false,
      OR: [
        { reference: `SALE:${sale.id}` },
        { reference: sale.id },
        { reference: sale.number, reason: { startsWith: 'Venda' } },
      ],
    },
  });
  if (!existing) await deductSaleStock(tx, sale, 'Venda PDV - reserva de estoque');
}

async function returnSaleStock(tx: Tx, sale: SaleWithItems) {
  const deducted = await tx.stockMovement.findFirst({
    where: {
      officeId: sale.officeId,
      type: 'SAIDA',
      deleted: false,
      OR: [
        { reference: `SALE:${sale.id}` },
        { reference: sale.id },
        { reference: sale.number, reason: { startsWith: 'Venda' } },
      ],
    },
  });
  if (!deducted) return;
  const alreadyReturned = await tx.stockMovement.findFirst({
    where: { officeId: sale.officeId, type: 'ENTRADA', deleted: false, reference: `SALE:${sale.id}`, reason: { startsWith: 'Cancelamento' } },
  });
  if (alreadyReturned) return;
  for (const item of sale.items) {
    if (!item.partId || item.deleted) continue;
    await adjustStock(tx, {
      officeId: sale.officeId,
      partId: item.partId,
      delta: Number(item.quantity),
      reason: 'Cancelamento de venda PDV',
      reference: `SALE:${sale.id}`,
    });
  }
}

export async function createSale(input: z.infer<typeof createSaleSchema>, actor: { userId: string; role: string }) {
  if (input.paymentMethod && input.pendingPayment) {
    throw new CommercialError('Venda pendente não deve informar forma de pagamento', 400);
  }
  const subtotalCents = input.items.reduce((sum, i) => sum + Math.round(toCents(i.unitPrice) * i.quantity), 0);
  const discountCents = toCents(input.discount);
  if (discountCents > subtotalCents) throw new CommercialError('Desconto não pode ser maior que o subtotal', 400);
  const totalCents = subtotalCents - discountCents;
  const paid = Boolean(input.paymentMethod) && !input.pendingPayment;

  return db.$transaction(async (tx) => {
    if (input.clientId) {
      const client = await tx.client.findFirst({ where: { id: input.clientId, officeId: input.officeId, deleted: false } });
      if (!client) throw new CommercialError('Cliente não encontrado nesta oficina', 404);
    }
    const sellerId = input.sellerId || input.userId || actor.userId;
    if (sellerId !== actor.userId && actor.role === 'EMPLOYEE') {
      throw new CommercialError('Funcionário não pode registrar venda em nome de outro usuário', 403);
    }
    const seller = await tx.user.findFirst({ where: { id: sellerId, officeId: input.officeId, active: true, deleted: false } });
    if (!seller) throw new CommercialError('Vendedor não encontrado nesta oficina', 404);

    for (const item of input.items) {
      if (item.partId) {
        const part = await tx.part.findFirst({ where: { id: item.partId, officeId: input.officeId, deleted: false } });
        if (!part) throw new CommercialError(`Peça não encontrada nesta oficina: ${item.partId}`, 404);
      }
    }

    const number = await nextSaleNumber(tx, input.officeId);
    const cashSession = await tx.cashSession.findFirst({ where: { officeId: input.officeId, userId: actor.userId, status: 'ABERTO' } });
    if (paid && input.paymentMethod === 'DINHEIRO' && !cashSession) {
      throw new CommercialError('Abra o caixa antes de registrar venda em dinheiro', 409);
    }

    const sale = await tx.sale.create({
      data: {
        number,
        status: paid ? 'PAGA' : 'ABERTA',
        discount: fromCents(discountCents),
        totalAmount: fromCents(totalCents),
        paymentMethod: paid ? input.paymentMethod : null,
        paidAt: paid ? new Date() : null,
        obs: input.obs || null,
        clientId: input.clientId || null,
        userId: sellerId,
        cashSessionId: cashSession?.id || null,
        officeId: input.officeId,
        items: {
          create: input.items.map(i => ({
            description: i.description,
            quantity: i.quantity,
            unitPrice: i.unitPrice,
            totalPrice: fromCents(Math.round(toCents(i.unitPrice) * i.quantity)),
            partId: i.partId || null,
            officeId: input.officeId,
          })),
        },
      },
      include: { items: true, client: { select: { id: true, name: true } }, user: { select: { id: true, name: true, email: true } } },
    });

    await deductSaleStock(tx, sale, 'Venda PDV - reserva de estoque');

    if (paid) {
      await tx.financialEntry.create({
        data: {
          type: 'RECEBER', category: 'PDV', description: `Venda ${number}`,
          amount: fromCents(subtotalCents), discount: fromCents(discountCents), interest: 0,
          totalAmount: fromCents(totalCents), status: 'PAGO', dueDate: new Date(), paymentDate: new Date(),
          paymentMethod: input.paymentMethod, reference: number, saleId: sale.id, officeId: input.officeId,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        action: 'CREATE', entity: 'Sale', entityId: sale.id,
        details: JSON.stringify({ number, totalAmount: fromCents(totalCents), items: input.items.length }),
        userId: actor.userId, officeId: input.officeId,
      },
    });
    return sale;
  });
}

export async function paySale(saleId: string, officeId: string, paymentMethod: z.infer<typeof paymentMethodSchema>, actorId: string, discount?: number) {
  return db.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({ where: { id: saleId, officeId, deleted: false }, include: { items: { where: { deleted: false } } } });
    if (!sale) throw new CommercialError('Venda não encontrada', 404);
    if (sale.status === 'PAGA') return sale; // idempotent retry
    if (sale.status !== 'ABERTA') throw new CommercialError(`Não é possível pagar venda ${sale.status}`, 409);

    const subtotalCents = sale.items.reduce((sum, i) => sum + toCents(Number(i.totalPrice)), 0);
    const discountCents = toCents(discount ?? Number(sale.discount));
    if (discountCents > subtotalCents) throw new CommercialError('Desconto não pode ser maior que o subtotal', 400);
    const totalCents = subtotalCents - discountCents;

    const claimed = await tx.sale.updateMany({
      where: { id: saleId, officeId, status: 'ABERTA', deleted: false },
      data: { status: 'PAGA', paymentMethod, paidAt: new Date(), discount: fromCents(discountCents), totalAmount: fromCents(totalCents) },
    });
    if (claimed.count !== 1) throw new CommercialError('Venda alterada por outra operação. Recarregue e tente novamente.', 409);

    await ensureSaleStockDeducted(tx, sale);
    await tx.financialEntry.create({
      data: {
        type: 'RECEBER', category: 'PDV', description: `Venda ${sale.number}`,
        amount: fromCents(subtotalCents), discount: fromCents(discountCents), interest: 0,
        totalAmount: fromCents(totalCents), status: 'PAGO', dueDate: new Date(), paymentDate: new Date(),
        paymentMethod, reference: sale.number, saleId: sale.id, officeId,
      },
    });
    await tx.auditLog.create({
      data: { action: 'PAYMENT_APPROVED', entity: 'Sale', entityId: sale.id, details: JSON.stringify({ paymentMethod, totalAmount: fromCents(totalCents) }), userId: actorId, officeId },
    });
    return tx.sale.findFirst({ where: { id: saleId, officeId }, include: { items: true, client: true } });
  });
}

export async function cancelSale(saleId: string, officeId: string, actorId: string) {
  return db.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({ where: { id: saleId, officeId, deleted: false }, include: { items: { where: { deleted: false } } } });
    if (!sale) throw new CommercialError('Venda não encontrada', 404);
    if (sale.status === 'CANCELADA') return sale;
    if (sale.status === 'PAGA') throw new CommercialError('Venda paga não pode ser cancelada diretamente. Registre o estorno do pagamento antes do cancelamento.', 409);

    const claimed = await tx.sale.updateMany({
      where: { id: saleId, officeId, status: 'ABERTA', deleted: false },
      data: { status: 'CANCELADA' },
    });
    if (claimed.count !== 1) throw new CommercialError('Venda alterada por outra operação. Recarregue e tente novamente.', 409);

    await returnSaleStock(tx, sale);
    await tx.financialEntry.updateMany({
      where: { saleId, officeId, deleted: false, status: { in: ['PENDENTE', 'ATRASADO'] } },
      data: { status: 'CANCELADO' },
    });
    await tx.auditLog.create({
      data: { action: 'CANCEL', entity: 'Sale', entityId: sale.id, details: JSON.stringify({ number: sale.number }), userId: actorId, officeId },
    });
    return tx.sale.findFirst({ where: { id: saleId, officeId }, include: { items: true, client: true } });
  });
}

export async function updateOpenSale(saleId: string, officeId: string, input: { discount?: number; obs?: string | null }) {
  return db.$transaction(async (tx) => {
    const sale = await tx.sale.findFirst({ where: { id: saleId, officeId, deleted: false }, include: { items: { where: { deleted: false } } } });
    if (!sale) throw new CommercialError('Venda não encontrada', 404);
    if (sale.status !== 'ABERTA') throw new CommercialError('Valores de venda paga/cancelada são imutáveis', 409);
    const subtotalCents = sale.items.reduce((sum, i) => sum + toCents(Number(i.totalPrice)), 0);
    const discountCents = toCents(input.discount ?? Number(sale.discount));
    if (discountCents > subtotalCents) throw new CommercialError('Desconto não pode ser maior que o subtotal', 400);
    const updated = await tx.sale.updateMany({
      where: { id: saleId, officeId, status: 'ABERTA', deleted: false },
      data: { discount: fromCents(discountCents), totalAmount: fromCents(subtotalCents - discountCents), ...(input.obs !== undefined ? { obs: input.obs } : {}) },
    });
    if (updated.count !== 1) throw new CommercialError('Venda alterada por outra operação', 409);
    return tx.sale.findFirst({ where: { id: saleId, officeId }, include: { items: true, client: true } });
  });
}
