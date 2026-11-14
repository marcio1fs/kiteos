import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { PLANS, assertCanCreate, isPlanError } from '@/lib/plans';
import {
  DATABASE_URL,
  createPool,
  makePlanStore,
  nextId,
  resetDatabaseWithMigrations,
  seedClients,
  seedOffice,
  seedPart,
  seedRefreshToken,
  seedSale,
  seedSubscription,
  seedUser,
  sleep,
  withTransaction,
} from './helpers/pg';

/**
 * Concurrency and integrity guarantees, verified against a REAL PostgreSQL.
 *
 * The acceptance suite proves the code emits the right predicates; this suite
 * proves PostgreSQL actually delivers the guarantee those predicates assume —
 * row-level atomicity, unique constraints, transaction-scoped advisory locks
 * and compare-and-set updates — with many transactions in flight at once.
 *
 * Skipped entirely unless DATABASE_URL is set (see vitest.integration.config.ts).
 */
const describeDb = DATABASE_URL ? describe : describe.skip;
if (!DATABASE_URL) {
  console.warn('[integration] DATABASE_URL ausente — testes de integração com PostgreSQL real foram pulados.');
}

const OFFICE = 'office-it-a';
const OFFICE_B = 'office-it-b';

describeDb('integridade e concorrência em PostgreSQL real', () => {
  let pool: pg.Pool;
  let migrations: string[] = [];

  async function countClients(officeId: string): Promise<number> {
    const res = await pool.query(`SELECT count(*)::int AS n FROM clients WHERE "officeId" = $1 AND deleted = false`, [officeId]);
    return res.rows[0].n;
  }

  async function partQuantity(partId: string): Promise<number> {
    const res = await pool.query(`SELECT quantity FROM parts WHERE id = $1`, [partId]);
    return Number(res.rows[0].quantity);
  }

  /** One guarded creation: the production guard plus the INSERT it protects. */
  function guardedClientCreate(officeId: string) {
    return withTransaction(pool, async (conn) => {
      await assertCanCreate(makePlanStore(conn), officeId, 'CLIENT');
      await conn.query(
        `INSERT INTO clients (id, name, "officeId", deleted, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, false, now(), now())`,
        [nextId('client'), 'Cliente concorrente', officeId],
      );
    });
  }

  const countSettled = (results: PromiseSettledResult<unknown>[]) =>
    results.filter((r) => r.status === 'fulfilled').length;
  const countPlanRefusals = (results: PromiseSettledResult<unknown>[]) =>
    results.filter((r) => r.status === 'rejected' && isPlanError((r as PromiseRejectedResult<unknown>).reason)).length;

  beforeAll(async () => {
    pool = createPool();
    migrations = await resetDatabaseWithMigrations(pool);
    await seedOffice(pool, OFFICE);
    await seedOffice(pool, OFFICE_B, { cnpj: 'office-it-b.cnpj', email: 'office-it-b@example.invalid' });
    await seedSubscription(pool, { officeId: OFFICE, plan: 'PRO' });
    await seedSubscription(pool, { officeId: OFFICE_B, plan: 'FREE' });
  }, 180_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('aplica as migrations versionadas num banco real', async () => {
    expect(migrations.length).toBeGreaterThan(0);
    const tables = await pool.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    expect(tables.rows[0].n).toBe(36);
  });

  describe('limite de plano sob concorrência', () => {
    it('libera exatamente uma criação entre 12 concorrentes quando resta uma vaga', async () => {
      const office = nextId('office-limit');
      await seedOffice(pool, office);
      await seedSubscription(pool, { officeId: office, plan: 'FREE', periodStart: new Date(Date.now() - 86_400_000) });
      await seedClients(pool, office, PLANS.FREE.maxClients - 1);

      const results = await Promise.allSettled(
        Array.from({ length: 12 }, () => guardedClientCreate(office)),
      );

      expect(countSettled(results)).toBe(1);
      expect(countPlanRefusals(results)).toBe(11);
      expect(await countClients(office)).toBe(PLANS.FREE.maxClients);
    });

    it('mostra a corrida que a trava evita: contar sem travar ultrapassa o limite', async () => {
      const office = nextId('office-race');
      await seedOffice(pool, office);
      await seedSubscription(pool, { officeId: office, plan: 'FREE' });
      await seedClients(pool, office, PLANS.FREE.maxClients - 1);

      // Same check, deliberately without the advisory lock, with a pause between
      // reading the count and inserting so the transactions interleave.
      const unsafeCreate = () =>
        withTransaction(pool, async (conn) => {
          const res = await conn.query(
            `SELECT count(*)::int AS n FROM clients WHERE "officeId" = $1 AND deleted = false`,
            [office],
          );
          await sleep(120);
          if (res.rows[0].n >= PLANS.FREE.maxClients) throw new Error('limite atingido');
          await conn.query(
            `INSERT INTO clients (id, name, "officeId", deleted, "createdAt", "updatedAt")
             VALUES ($1, $2, $3, false, now(), now())`,
            [nextId('client'), 'Cliente sem trava', office],
          );
        });

      await Promise.allSettled(Array.from({ length: 5 }, unsafeCreate));

      const total = await countClients(office);
      expect(total).toBeGreaterThan(PLANS.FREE.maxClients);
    });

    it('não limita um plano ilimitado, mesmo acima do teto dos planos menores', async () => {
      const office = nextId('office-premium');
      await seedOffice(pool, office);
      await seedSubscription(pool, { officeId: office, plan: 'PREMIUM' });

      const results = await Promise.allSettled(Array.from({ length: 30 }, () => guardedClientCreate(office)));

      expect(countSettled(results)).toBe(30);
      expect(await countClients(office)).toBe(30);
    });

    it('aplica o FREE enquanto um upgrade está pendente de pagamento', async () => {
      const office = nextId('office-pending');
      await seedOffice(pool, office);
      await seedSubscription(pool, { officeId: office, plan: 'PREMIUM', status: 'PENDENTE' });
      await seedClients(pool, office, PLANS.FREE.maxClients - 1);

      const results = await Promise.allSettled(Array.from({ length: 8 }, () => guardedClientCreate(office)));

      expect(countSettled(results)).toBe(1);
      expect(await countClients(office)).toBe(PLANS.FREE.maxClients);
    });

    it('trava por oficina: concorrência em outra oficina não é afetada', async () => {
      const officeA = nextId('office-par-a');
      const officeB = nextId('office-par-b');
      for (const office of [officeA, officeB]) {
        await seedOffice(pool, office);
        await seedSubscription(pool, { officeId: office, plan: 'FREE' });
        await seedClients(pool, office, PLANS.FREE.maxClients - 1);
      }

      const results = await Promise.allSettled([
        ...Array.from({ length: 4 }, () => guardedClientCreate(officeA)),
        ...Array.from({ length: 4 }, () => guardedClientCreate(officeB)),
      ]);

      // One slot per office, so exactly two creations succeed overall.
      expect(countSettled(results)).toBe(2);
      expect(await countClients(officeA)).toBe(PLANS.FREE.maxClients);
      expect(await countClients(officeB)).toBe(PLANS.FREE.maxClients);
    });
  });

  describe('estoque', () => {
    it('nunca vende além do saldo: 20 baixas concorrentes sobre saldo 5', async () => {
      const partId = await seedPart(pool, OFFICE, 5, 'SKU-SALDO');

      const attempt = () =>
        withTransaction(pool, async (conn) => {
          const res = await conn.query(
            `UPDATE parts SET quantity = quantity - 1, version = version + 1, "updatedAt" = now()
             WHERE id = $1 AND "officeId" = $2 AND deleted = false AND quantity >= 1`,
            [partId, OFFICE],
          );
          if (res.rowCount !== 1) throw new Error('saldo insuficiente');
        });

      const results = await Promise.allSettled(Array.from({ length: 20 }, attempt));

      expect(countSettled(results)).toBe(5);
      expect(await partQuantity(partId)).toBe(0);
    });

    it('faz exatamente um escritor vencer um CAS de versão entre 10 concorrentes', async () => {
      const partId = await seedPart(pool, OFFICE, 100, 'SKU-CAS');

      const attempt = () =>
        withTransaction(pool, async (conn) => {
          const current = (
            await conn.query(`SELECT quantity, version FROM parts WHERE id = $1 AND "officeId" = $2`, [partId, OFFICE])
          ).rows[0];
          await sleep(60); // force every writer to read the same version
          const res = await conn.query(
            `UPDATE parts SET quantity = $3, version = $4 + 1, "updatedAt" = now()
             WHERE id = $1 AND "officeId" = $2 AND deleted = false AND version = $4 AND quantity >= 1`,
            [partId, OFFICE, Number(current.quantity) - 1, current.version],
          );
          if (res.rowCount !== 1) throw new Error('registro alterado por outra operação');
        });

      const results = await Promise.allSettled(Array.from({ length: 10 }, attempt));

      expect(countSettled(results)).toBe(1);
      expect(await partQuantity(partId)).toBe(99);
    });

    it('não altera a peça de outra oficina mesmo usando a chave primária dela', async () => {
      const partB = await seedPart(pool, OFFICE_B, 7, 'SKU-TENANT');

      const res = await pool.query(
        `UPDATE parts SET quantity = 999, "updatedAt" = now() WHERE id = $1 AND "officeId" = $2 AND deleted = false`,
        [partB, OFFICE],
      );

      expect(res.rowCount).toBe(0);
      expect(await partQuantity(partB)).toBe(7);
    });
  });

  describe('numeração e unicidade', () => {
    it('entrega 25 números distintos a upserts concorrentes do sequenciador', async () => {
      const attempt = () =>
        withTransaction(pool, async (conn) => {
          const res = await conn.query(
            `INSERT INTO sequencers (id, "officeId", entity, "currentValue", "updatedAt")
             VALUES ($1, $2, 'SERVICE_ORDER', 1, now())
             ON CONFLICT ("officeId", entity)
             DO UPDATE SET "currentValue" = sequencers."currentValue" + 1, "updatedAt" = now()
             RETURNING "currentValue"`,
            [nextId('seq'), OFFICE],
          );
          return res.rows[0].currentValue as number;
        });

      const values = await Promise.all(Array.from({ length: 25 }, attempt));

      expect(new Set(values).size).toBe(25);
      expect([...values].sort((a, b) => a - b)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
    });

    it('impede número de venda duplicado na mesma oficina, mas permite em outra', async () => {
      const insert = (officeId: string) =>
        withTransaction(pool, async (conn) => {
          await conn.query(
            `INSERT INTO sales (id, number, status, discount, "totalAmount", "officeId", deleted, "createdAt", "updatedAt")
             VALUES ($1, 'A777', 'ABERTA', 0, 100, $2, false, now(), now())`,
            [nextId('sale'), officeId],
          );
        });

      const results = await Promise.allSettled(Array.from({ length: 10 }, () => insert(OFFICE)));
      expect(countSettled(results)).toBe(1);
      const uniqueViolations = results.filter(
        (r) => r.status === 'rejected' && (r as PromiseRejectedResult<{ code?: string }>).reason?.code === '23505',
      );
      expect(uniqueViolations).toHaveLength(9);

      // The same number in another tenant is legitimate: uniqueness is per office.
      await expect(insert(OFFICE_B)).resolves.toBeUndefined();
    });
  });

  describe('transições de estado idempotentes', () => {
    it('liquida uma venda aberta exatamente uma vez entre 10 pagamentos concorrentes', async () => {
      const saleId = await seedSale(pool, OFFICE, 'A888');

      const attempt = () =>
        withTransaction(pool, async (conn) => {
          const res = await conn.query(
            `UPDATE sales SET status = 'PAGA', "paidAt" = now(), "updatedAt" = now()
             WHERE id = $1 AND "officeId" = $2 AND status = 'ABERTA'`,
            [saleId, OFFICE],
          );
          if (res.rowCount !== 1) throw new Error('venda já liquidada');
        });

      const results = await Promise.allSettled(Array.from({ length: 10 }, attempt));

      expect(countSettled(results)).toBe(1);
      const status = await pool.query(`SELECT status FROM sales WHERE id = $1`, [saleId]);
      expect(status.rows[0].status).toBe('PAGA');
    });

    it('revoga um refresh token exatamente uma vez, tornando o reuso detectável', async () => {
      const userId = nextId('user');
      await seedUser(pool, userId, OFFICE);
      const token = nextId('token');
      await seedRefreshToken(pool, userId, OFFICE, token);

      const attempt = () =>
        withTransaction(pool, async (conn) => {
          const res = await conn.query(
            `UPDATE "RefreshToken" SET "isRevoked" = true, "revokedAt" = now()
             WHERE token = $1 AND "isRevoked" = false`,
            [token],
          );
          if (res.rowCount !== 1) throw new Error('token já revogado — possível reuso');
        });

      const results = await Promise.allSettled(Array.from({ length: 10 }, attempt));

      expect(countSettled(results)).toBe(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(9);
    });
  });
});
