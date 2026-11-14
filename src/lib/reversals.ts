import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { CommercialError, fromCents, toCents, type Tx } from '@/lib/commercial';

/**
 * Explicit reversal ("estorno") of settled money.
 *
 * Nothing is deleted and no paid amount is silently rewritten: a reversal moves
 * the original entry to ESTORNADO and writes a COMPENSATING entry of the
 * opposite type, so the ledger still adds up and the original document keeps its
 * history. Three code paths already refused to act without this flow —
 * cancelling a paid sale (`sales.ts`), deleting a paid financial entry
 * (`api/financial/[id]`) and a Mercado Pago refund webhook — and all three
 * pointed at a reversal that did not exist. Those are BIZ-05, BIZ-07 and PAY-06
 * in audit/RELATORIO-AUDITORIA.md.
 *
 * Concurrency: the status transition is the lock. `updateMany` with
 * `status: 'PAGO'` in the WHERE clause lets PostgreSQL elect exactly one winner,
 * so two simultaneous reversals of the same entry cannot both create a
 * compensating launch. Retries (webhooks, double clicks) find the entry already
 * ESTORNADO and get the existing reversal back instead of a second one.
 */

export const REVERSED_ENTRY_STATUS = 'ESTORNADO';

const OPPOSITE_TYPE: Record<string, 'RECEBER' | 'PAGAR'> = {
  RECEBER: 'PAGAR',
  PAGAR: 'RECEBER',
};

/** Links a compensating entry back to the entry it reverses; also the idempotency key. */
export function reversalReference(entryId: string): string {
  return `ESTORNO:${entryId}`;
}

export function oppositeEntryType(type: string): 'RECEBER' | 'PAGAR' {
  const opposite = OPPOSITE_TYPE[type];
  if (!opposite) throw new CommercialError(`Tipo de lançamento não estornável: ${type}`, 400);
  return opposite;
}

/** The reversal of `entryId`, if one was already written. */
export function findReversalOf(tx: Tx, officeId: string, entryId: string) {
  return tx.financialEntry.findFirst({
    where: { officeId, deleted: false, reference: reversalReference(entryId) },
  });
}

/**
 * Write the compensating entry for `original` inside an open transaction.
 *
 * Callers must have claimed the original first (see `claimForReversal`); this
 * function only produces the mirror launch and its audit trail. If a reversal
 * already exists it is returned unchanged, which keeps webhook retries safe.
 */
export async function createReversalEntry<T extends { id: string; officeId: string; type: string; description: string }>(
  tx: Tx,
  original: T & {
    category?: string | null;
    amount?: Prisma.Decimal | number | string;
    discount?: Prisma.Decimal | number | string;
    interest?: Prisma.Decimal | number | string;
    totalAmount: Prisma.Decimal | number | string;
    paymentMethod?: string | null;
    saleId?: string | null;
    supplierId?: string | null;
    invoiceId?: string | null;
  },
  opts: { actorId: string; reason: string; paymentMethod?: string | null; description?: string },
) {
  const existing = await findReversalOf(tx, original.officeId, original.id);
  if (existing) return { entry: existing, created: false };

  const totalCents = toCents(Number(original.totalAmount));
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    throw new CommercialError('Lançamento sem valor positivo a estornar', 400);
  }

  const entry = await tx.financialEntry.create({
    data: {
      // Money flows the other way: a settled RECEBER becomes a paid PAGAR.
      type: oppositeEntryType(original.type),
      category: original.category ?? 'ESTORNO',
      description: opts.description ?? `Estorno: ${original.description}`,
      amount: new Prisma.Decimal(Number(original.amount ?? original.totalAmount)),
      discount: new Prisma.Decimal(Number(original.discount ?? 0)),
      interest: new Prisma.Decimal(Number(original.interest ?? 0)),
      totalAmount: fromCents(totalCents),
      status: 'PAGO',
      dueDate: new Date(),
      paymentDate: new Date(),
      paymentMethod: opts.paymentMethod ?? original.paymentMethod ?? null,
      reference: reversalReference(original.id),
      saleId: original.saleId ?? null,
      supplierId: original.supplierId ?? null,
      invoiceId: original.invoiceId ?? null,
      officeId: original.officeId,
    },
  });

  await tx.auditLog.create({
    data: {
      action: 'REVERSAL',
      entity: 'FinancialEntry',
      entityId: original.id,
      details: JSON.stringify({
        reversalId: entry.id,
        reason: opts.reason,
        type: entry.type,
        totalAmount: fromCents(totalCents),
      }),
      userId: opts.actorId,
      officeId: original.officeId,
    },
  });

  return { entry, created: true };
}

/**
 * Claim a paid entry for reversal: PAGO -> ESTORNADO, decided by PostgreSQL.
 * Returns null when someone else already claimed it (caller decides between
 * "already reversed" and a 409).
 */
export async function claimForReversal(tx: Tx, entryId: string, officeId: string): Promise<boolean> {
  const claimed = await tx.financialEntry.updateMany({
    where: { id: entryId, officeId, deleted: false, status: 'PAGO' },
    data: { status: REVERSED_ENTRY_STATUS },
  });
  return claimed.count === 1;
}

export type ReversalActor = { userId: string; role: string };

/**
 * Actor for machine-initiated reversals (a payment webhook whose signature was
 * already verified). `SYSTEM` is not a user role — JWT payloads are typed
 * OWNER | ADMIN | EMPLOYEE and employee creation only accepts EMPLOYEE | ADMIN —
 * so no request can claim it; only server code can build this actor.
 */
export function systemActor(id: string): ReversalActor {
  return { userId: id, role: 'SYSTEM' };
}

/** Only OWNER/ADMIN (or verified server code) may reverse settled money — BIZ-07. */
export function assertCanReverse(actor: ReversalActor): void {
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN' && actor.role !== 'SYSTEM') {
    throw new CommercialError('Apenas proprietário ou administrador pode registrar estorno', 403);
  }
}

/**
 * Reverse a paid financial entry that is NOT tied to a sale.
 * Sale entries are reversed through the sale flow (`reverseSale`), which also
 * returns the stock — reversing only the money there would leave the two apart.
 */
export async function reverseFinancialEntry(
  entryId: string,
  officeId: string,
  actor: ReversalActor,
  input: { reason: string; paymentMethod?: string | null },
) {
  assertCanReverse(actor);

  return db.$transaction(async (tx) => {
    const original = await tx.financialEntry.findFirst({ where: { id: entryId, officeId, deleted: false } });
    if (!original) throw new CommercialError('Entrada financeira não encontrada', 404);
    if (original.saleId) {
      throw new CommercialError('Lançamentos de venda são estornados pelo fluxo da venda, que também devolve o estoque', 409);
    }
    if (original.status === REVERSED_ENTRY_STATUS) {
      const already = await findReversalOf(tx, officeId, entryId);
      return { entry: original, reversal: already, alreadyReversed: true };
    }
    if (original.status !== 'PAGO') {
      throw new CommercialError(`Somente lançamento pago pode ser estornado (status atual: ${original.status})`, 409);
    }

    if (!(await claimForReversal(tx, entryId, officeId))) {
      throw new CommercialError('Lançamento estornado por outra operação. Recarregue e tente novamente.', 409);
    }
    const claimed = await tx.financialEntry.findFirst({ where: { id: entryId, officeId } });
    if (!claimed) throw new CommercialError('Entrada financeira não encontrada', 404);

    const { entry: reversal } = await createReversalEntry(tx, claimed, {
      actorId: actor.userId,
      reason: input.reason,
      paymentMethod: input.paymentMethod,
    });

    return {
      entry: claimed,
      reversal,
      alreadyReversed: false,
    };
  });
}
