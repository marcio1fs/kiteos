import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
  DATABASE_URL,
  createPool,
  nextId,
  resetDatabaseWithMigrations,
  seedOffice,
  seedPaidSale,
  seedUser,
} from './helpers/pg';

/**
 * The reversal flow exercised through the PRODUCTION code path (`reverseSale` /
 * `cancelSale` in src/lib/sales.ts) with the real PrismaClient against a real
 * PostgreSQL — not a re-implementation of its SQL.
 *
 * It needs a generated client WITH engine binaries, so it skips cleanly when
 * either the database or the client is unavailable (the audit sandbox has
 * neither; CI has both).
 */
const sales = DATABASE_URL ? await import('@/lib/sales').catch(() => null) : null;
const reversals = DATABASE_URL ? await import('@/lib/reversals').catch(() => null) : null;

if (DATABASE_URL && (!sales || !reversals)) {
  // A database was provided, so this suite is EXPECTED to run. Skipping here would
  // turn CI green without testing anything — fail loudly instead.
  throw new Error(
    'DATABASE_URL está definido mas o PrismaClient não carregou; os testes de estorno não podem ser pulados em silêncio.',
  );
}
if (!DATABASE_URL) {
  console.warn('[integration] DATABASE_URL ausente — testes de estorno pulados.');
}

const describeDb = sales && reversals ? describe : describe.skip;

const OFFICE = 'office-rev-a';
const OTHER_OFFICE = 'office-rev-b';

describeDb('estorno de venda paga em PostgreSQL real (código de produção)', () => {
  let pool: pg.Pool;
  let userId: string;

  const actor = () => ({ userId, role: 'OWNER' });

  async function saleRow(saleId: string) {
    const res = await pool.query(`SELECT status, "totalAmount" FROM sales WHERE id = $1`, [saleId]);
    return res.rows[0] as { status: string; totalAmount: string };
  }

  async function partQuantity(partId: string): Promise<number> {
    const res = await pool.query(`SELECT quantity FROM parts WHERE id = $1`, [partId]);
    return Number(res.rows[0].quantity);
  }

  async function entryCounts(saleId: string) {
    const res = await pool.query(
      `SELECT
         count(*) FILTER (WHERE reference LIKE 'ESTORNO:%')::int AS reversals,
         count(*) FILTER (WHERE status = 'ESTORNADO')::int AS reversed,
         count(*) FILTER (WHERE status = 'PAGO')::int AS paid,
         coalesce(sum(CASE WHEN type = 'RECEBER' THEN "totalAmount" ELSE -"totalAmount" END), 0)::numeric AS ledger
       FROM financial_entries WHERE "saleId" = $1 AND deleted = false`,
      [saleId],
    );
    const row = res.rows[0];
    return { reversals: row.reversals, reversed: row.reversed, paid: row.paid, ledger: Number(row.ledger) };
  }

  async function movements(saleId: string) {
    const res = await pool.query(
      `SELECT count(*) FILTER (WHERE type = 'SAIDA')::int AS out,
              count(*) FILTER (WHERE type = 'ENTRADA')::int AS back
       FROM stock_movements WHERE reference = $1 AND deleted = false`,
      [`SALE:${saleId}`],
    );
    return res.rows[0] as { out: number; back: number };
  }

  /** Reversal audit rows are keyed by the entity they describe: the sale for the
   *  Sale row, and the launch itself for the FinancialEntry row. */
  async function auditCount(entityId: string, entity: string) {
    const res = await pool.query(
      `SELECT count(*)::int AS n FROM audit_logs WHERE "entityId" = $1 AND entity = $2 AND action = 'REVERSAL'`,
      [entityId, entity],
    );
    return res.rows[0].n as number;
  }

  /** A paid sale of 2 units out of a part that had 5: balance is now 3. */
  async function newPaidSale(officeId = OFFICE) {
    return seedPaidSale(pool, { officeId, userId, quantity: 2, partQuantity: 3, total: 100 });
  }

  const statusOf = (r: PromiseRejectedResult<unknown>) => (r.reason as { status?: number })?.status;

  beforeAll(async () => {
    pool = createPool();
    await resetDatabaseWithMigrations(pool);
    await seedOffice(pool, OFFICE);
    await seedOffice(pool, OTHER_OFFICE, { cnpj: 'office-rev-b.cnpj', email: 'office-rev-b@example.invalid' });
    userId = nextId('user');
    await seedUser(pool, userId, OFFICE, 'OWNER');
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('10 estornos concorrentes da mesma venda produzem exatamente um reembolso', async () => {
    const seeded = await newPaidSale();

    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        sales!.reverseSale(seeded.saleId, OFFICE, actor(), { reason: 'cliente desistiu da compra' }),
      ),
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled') as PromiseFulfilledResult<{ alreadyReversed: boolean }>[];
    const rejected = results.filter(r => r.status === 'rejected') as PromiseRejectedResult<unknown>[];
    expect(fulfilled.length + rejected.length).toBe(10);

    // Exactly one caller may PERFORM the reversal. What the other nine see depends
    // on interleaving: whoever loses the CAS gets 409, and whoever reads the sale
    // after the winner committed takes the idempotent path and gets
    // alreadyReversed. Both are correct, so the assertion is on how many actually
    // reversed — never on the split.
    expect(fulfilled.filter(r => r.value.alreadyReversed === false)).toHaveLength(1);
    expect(rejected.every(r => statusOf(r) === 409)).toBe(true);

    expect((await saleRow(seeded.saleId)).status).toBe('ESTORNADA');

    const entries = await entryCounts(seeded.saleId);
    expect(entries.reversals).toBe(1);
    expect(entries.reversed).toBe(1);
    expect(entries.paid).toBe(1); // o lançamento compensatório, pago
    expect(entries.ledger).toBe(0); // RECEBER +100 e PAGAR -100: o razão zera

    const mov = await movements(seeded.saleId);
    expect(mov).toEqual({ out: 1, back: 1 });
    expect(await partQuantity(seeded.partId)).toBe(5); // 3 + 2 devolvidas, uma única vez

    expect(await auditCount(seeded.saleId, 'Sale')).toBe(1);
    expect(await auditCount(seeded.entryId, 'FinancialEntry')).toBe(1);
  });

  it('ator de máquina estorna sem violar a FK de audit_logs.userId', async () => {
    // `audit_logs.userId` references `users.id`. A webhook is not a user, so its
    // label must land in details.actor with the FK left null: writing the label
    // into the column aborts the whole reversal transaction on a real database.
    // Only a real PostgreSQL can prove this — mocks have no foreign keys.
    const seeded = await newPaidSale();

    await sales!.reverseSale(seeded.saleId, OFFICE, reversals!.systemActor('mercadopago-webhook'), {
      reason: 'Estorno Mercado Pago: pagamento 12345 com status refunded',
    });

    expect((await saleRow(seeded.saleId)).status).toBe('ESTORNADA');

    for (const [entityId, entity] of [[seeded.saleId, 'Sale'], [seeded.entryId, 'FinancialEntry']] as const) {
      const res = await pool.query(
        `SELECT "userId", details FROM audit_logs WHERE "entityId" = $1 AND entity = $2 AND action = 'REVERSAL'`,
        [entityId, entity],
      );
      expect(res.rows, entity).toHaveLength(1);
      expect(res.rows[0].userId, `${entity}: FK precisa ficar nula para ator de máquina`).toBeNull();
      expect(JSON.parse(res.rows[0].details as string)).toMatchObject({ actor: 'mercadopago-webhook' });
    }
  });

  it('retry depois do estorno não cria nada (idempotência de webhook)', async () => {
    const seeded = await newPaidSale();
    await sales!.reverseSale(seeded.saleId, OFFICE, actor(), { reason: 'primeira chamada' });
    const before = { ...(await entryCounts(seeded.saleId)), ...(await movements(seeded.saleId)) };

    const retry = await sales!.reverseSale(seeded.saleId, OFFICE, actor(), { reason: 'retry do Mercado Pago' });

    expect(retry.alreadyReversed).toBe(true);
    expect(retry.reversal).not.toBeNull();
    const after = { ...(await entryCounts(seeded.saleId)), ...(await movements(seeded.saleId)) };
    expect(after).toEqual(before);
    expect(await partQuantity(seeded.partId)).toBe(5);
    expect(await auditCount(seeded.saleId, 'Sale')).toBe(1);
  });

  it('cancelar depois de estornar não devolve o estoque duas vezes', async () => {
    const seeded = await newPaidSale();
    await sales!.reverseSale(seeded.saleId, OFFICE, actor(), { reason: 'devolução do cliente' });
    expect(await partQuantity(seeded.partId)).toBe(5);

    await sales!.cancelSale(seeded.saleId, OFFICE, userId);

    expect((await saleRow(seeded.saleId)).status).toBe('CANCELADA');
    expect(await movements(seeded.saleId)).toEqual({ out: 1, back: 1 });
    expect(await partQuantity(seeded.partId)).toBe(5);
    const entries = await entryCounts(seeded.saleId);
    expect(entries.reversals).toBe(1);
    expect(entries.ledger).toBe(0);
  });

  it('estorno concorrente com cancelamento: só uma das duas transições vence', async () => {
    const seeded = await newPaidSale();

    const results = await Promise.allSettled([
      ...Array.from({ length: 4 }, () => sales!.reverseSale(seeded.saleId, OFFICE, actor(), { reason: 'estorno' })),
      ...Array.from({ length: 4 }, () => sales!.cancelSale(seeded.saleId, OFFICE, userId)),
    ]);

    expect(results.some(r => r.status === 'fulfilled')).toBe(true);
    // Cancelling a PAGA sale is refused, so only a reversal can win first; a
    // cancellation that arrives AFTER the reversal committed is legitimate too
    // (ESTORNADA -> CANCELADA). The final status may therefore be either one —
    // what must not vary is the effect: one refund, ledger zero, stock back once.
    expect(['ESTORNADA', 'CANCELADA']).toContain((await saleRow(seeded.saleId)).status);
    expect(await movements(seeded.saleId)).toEqual({ out: 1, back: 1 });
    expect(await partQuantity(seeded.partId)).toBe(5);
    expect((await entryCounts(seeded.saleId)).reversals).toBe(1);
  });

  it('estorno de venda de outra oficina não existe e não escreve nada', async () => {
    const seeded = await newPaidSale();

    await expect(sales!.reverseSale(seeded.saleId, OTHER_OFFICE, actor(), { reason: 'cross-tenant' }))
      .rejects.toMatchObject({ status: 404 });

    expect((await saleRow(seeded.saleId)).status).toBe('PAGA');
    expect(await partQuantity(seeded.partId)).toBe(3);
    expect((await entryCounts(seeded.saleId)).reversals).toBe(0);
    expect(await movements(seeded.saleId)).toEqual({ out: 1, back: 0 });
  });

  it('funcionário não estorna: a venda continua paga e intocada', async () => {
    const seeded = await newPaidSale();

    await expect(sales!.reverseSale(seeded.saleId, OFFICE, { userId, role: 'EMPLOYEE' }, { reason: 'desistência' }))
      .rejects.toMatchObject({ status: 403 });

    expect((await saleRow(seeded.saleId)).status).toBe('PAGA');
    expect(await partQuantity(seeded.partId)).toBe(3);
    expect((await entryCounts(seeded.saleId)).reversals).toBe(0);
  });
});
