import { z } from 'zod';
import { Prisma } from '@prisma/client';

/** Expected business-rule failure. Routes map these to 4xx instead of leaking 500s. */
export class CommercialError extends Error {
  constructor(message: string, public readonly status = 409) {
    super(message);
    this.name = 'CommercialError';
  }
}

export const idSchema = z.string().trim().min(1).max(128);
export const moneySchema = z.number().finite().min(0).max(999_999_999.99)
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Valor deve ter no máximo 2 casas decimais');
export const quantitySchema = z.number().finite().positive().max(999_999.999)
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 1e-6, 'Quantidade deve ter no máximo 3 casas decimais');
export const paymentMethodSchema = z.enum([
  'DINHEIRO', 'PIX', 'CARTAO', 'CARTAO_CREDITO', 'CARTAO_DEBITO',
  'BOLETO', 'TRANSFERENCIA', 'MERCADO_PAGO', 'OUTRO',
]);

export function toCents(value: number): number {
  if (!Number.isFinite(value)) throw new CommercialError('Valor monetário inválido', 400);
  return Math.round((value + Number.EPSILON) * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function commercialErrorResponse(error: unknown) {
  if (error instanceof CommercialError) return { status: error.status, body: { success: false, error: error.message } };
  if (error instanceof z.ZodError) return { status: 400, body: { success: false, error: error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') } };
  return null;
}

export type Tx = Prisma.TransactionClient;

/**
 * Conditional stock update. Tenant, version and available balance are evaluated
 * by PostgreSQL in the same UPDATE that changes the balance. A stale reader gets
 * count=0 and the surrounding transaction is rolled back. Decimal arithmetic
 * avoids binary floating point drift for fractional quantities.
 */
export async function adjustStock(
  tx: Tx,
  args: {
    officeId: string;
    partId: string;
    delta: number;
    reason: string;
    reference: string;
    unitCost?: number;
  },
) {
  if (!Number.isFinite(args.delta) || args.delta === 0) throw new CommercialError('Movimentação de estoque inválida', 400);
  quantitySchema.parse(Math.abs(args.delta));
  const part = await tx.part.findFirst({ where: { id: args.partId, officeId: args.officeId, deleted: false } });
  if (!part) throw new CommercialError('Peça não encontrada nesta oficina', 404);

  const current = new Prisma.Decimal(part.quantity);
  const delta = new Prisma.Decimal(args.delta);
  const next = current.plus(delta);
  if (next.lessThan(0)) {
    throw new CommercialError(`Estoque insuficiente para "${part.description}". Disponível: ${current.toString()}`, 409);
  }

  const updated = await tx.part.updateMany({
    where: {
      id: part.id,
      officeId: args.officeId,
      deleted: false,
      version: part.version,
      ...(args.delta < 0 ? { quantity: { gte: delta.abs() } } : {}),
    },
    data: { quantity: next, version: { increment: 1 } },
  });
  if (updated.count !== 1) throw new CommercialError('Estoque alterado por outra operação. Tente novamente.', 409);

  const movement = await tx.stockMovement.create({
    data: {
      type: args.delta > 0 ? 'ENTRADA' : 'SAIDA',
      quantity: delta.abs(),
      unitCost: args.unitCost ?? Number(part.costPrice),
      reason: args.reason,
      reference: args.reference,
      partId: part.id,
      officeId: args.officeId,
    },
  });
  return { movement, previousQuantity: current.toNumber(), newQuantity: next.toNumber(), part };
}

/** Atomic per-office sequence. The unique key is the final duplicate guard. */
export async function nextOfficeSequence(tx: Tx, officeId: string, entity: string): Promise<number> {
  const row = await tx.sequencer.upsert({
    where: { officeId_entity: { officeId, entity } },
    create: { officeId, entity, currentValue: 1 },
    update: { currentValue: { increment: 1 } },
  });
  return row.currentValue;
}
