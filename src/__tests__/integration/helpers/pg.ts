import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import type { PlanStore } from '@/lib/plans';

/**
 * Real-PostgreSQL helpers for the integration suite.
 *
 * `makePlanStore` implements the slice of the Prisma delegate interface that
 * `src/lib/plans.ts` uses, backed by genuine SQL on a genuine connection. That
 * lets the tests drive the PRODUCTION guard (`assertCanCreate`) against real
 * transaction, locking and counting semantics, in an environment where the
 * Prisma query engine binary cannot be downloaded.
 */

export const DATABASE_URL = process.env.DATABASE_URL ?? null;

export function createPool(max = 40): pg.Pool {
  if (!DATABASE_URL) throw new Error('DATABASE_URL não definido');
  return new pg.Pool({ connectionString: DATABASE_URL, max });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let idCounter = 0;
export function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${process.pid}-${idCounter}`;
}

/** Drop the public schema and replay every migration in prisma/migrations. */
export async function resetDatabaseWithMigrations(pool: pg.Pool): Promise<string[]> {
  const dir = path.resolve(process.cwd(), 'prisma/migrations');
  const entries = (await fs.readdir(dir, { withFileTypes: true }))
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const client = await pool.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE');
    await client.query('CREATE SCHEMA public');
    for (const name of entries) {
      const sql = await fs.readFile(path.join(dir, name, 'migration.sql'), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${name} falhou: ${(err as Error).message}`);
      }
    }
  } finally {
    client.release();
  }
  return entries;
}

/** BEGIN → fn(conn) → COMMIT, with ROLLBACK on any error. */
export async function withTransaction<T>(pool: pg.Pool, fn: (conn: pg.PoolClient) => Promise<T>): Promise<T> {
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const result = await fn(conn);
    await conn.query('COMMIT');
    return result;
  } catch (err) {
    await conn.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    conn.release();
  }
}

export async function seedOffice(pool: pg.Pool, officeId: string, overrides: { cnpj?: string; email?: string } = {}) {
  await pool.query(
    `INSERT INTO offices (id, name, cnpj, email, active, deleted, "createdAt", "updatedAt", version)
     VALUES ($1, $2, $3, $4, true, false, now(), now(), 0)`,
    [officeId, `Oficina ${officeId}`, overrides.cnpj ?? `${officeId}.cnpj`, overrides.email ?? `${officeId}@example.invalid`],
  );
}

export async function seedUser(pool: pg.Pool, userId: string, officeId: string, role = 'OWNER') {
  await pool.query(
    `INSERT INTO users (id, email, password, name, role, "commissionRate", active, deleted, "officeId", "createdAt", "updatedAt")
     VALUES ($1, $2, 'x', $3, $4, 0, true, false, $5, now(), now())`,
    [userId, `${userId}@example.invalid`, `Usuário ${userId}`, role, officeId],
  );
}

export async function seedSubscription(
  pool: pg.Pool,
  args: { officeId: string; plan: string; status?: string; periodStart?: Date | null; periodEnd?: Date | null },
) {
  await pool.query(
    `INSERT INTO subscriptions (id, plan, status, "officeId", "startDate", "monthlyPrice",
                                "currentPeriodStart", "currentPeriodEnd", deleted, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, now(), 0, $5, $6, false, now(), now())`,
    [nextId('sub'), args.plan, args.status ?? 'ATIVA', args.officeId, args.periodStart ?? null, args.periodEnd ?? null],
  );
}

export async function seedClients(pool: pg.Pool, officeId: string, count: number) {
  for (let i = 0; i < count; i += 1) {
    await pool.query(
      `INSERT INTO clients (id, name, "officeId", deleted, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, false, now(), now())`,
      [nextId('client'), `Cliente ${i}`, officeId],
    );
  }
}

export async function seedPart(pool: pg.Pool, officeId: string, quantity: number, sku = 'SKU-1') {
  const id = nextId('part');
  await pool.query(
    `INSERT INTO parts (id, sku, description, quantity, "minQuantity", "costPrice", "salePrice",
                        "officeId", deleted, version, "createdAt", "updatedAt")
     VALUES ($1, $2, 'Peça de teste', $3, 0, 0, 0, $4, false, 0, now(), now())`,
    [id, sku, quantity, officeId],
  );
  return id;
}

export async function seedSale(pool: pg.Pool, officeId: string, number: string, status = 'ABERTA') {
  const id = nextId('sale');
  await pool.query(
    `INSERT INTO sales (id, number, status, discount, "totalAmount", "officeId", deleted, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 0, 100, $4, false, now(), now())`,
    [id, number, status, officeId],
  );
  return id;
}

export async function seedRefreshToken(pool: pg.Pool, userId: string, officeId: string, token: string) {
  await pool.query(
    `INSERT INTO "RefreshToken" (id, token, "userId", "officeId", role, "expiresAt", "createdAt", "isRevoked")
     VALUES ($1, $2, $3, $4, 'OWNER', now() + interval '30 days', now(), false)`,
    [nextId('rt'), token, userId, officeId],
  );
}

/**
 * PlanStore backed by real SQL on one connection, so it participates in that
 * connection's transaction — including the advisory lock taken by
 * `assertCanCreate`.
 */
export function makePlanStore(conn: pg.PoolClient): PlanStore {
  // `countPlanUsage` fires its three counts with Promise.all. A pg client cannot
  // run concurrent queries (deprecated in pg@8, removed in pg@9), and Prisma
  // serializes queries inside a transaction anyway — so queue them here to keep
  // the fake faithful and warning-free.
  let queue: Promise<unknown> = Promise.resolve();
  const run = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = queue.then(fn, fn);
    queue = result.catch(() => undefined);
    return result;
  };

  function buildWhere(where: Record<string, unknown> = {}) {
    const params: unknown[] = [];
    const clauses: string[] = [];
    const push = (clause: string, value: unknown) => {
      params.push(value);
      clauses.push(clause.replace('?', `$${params.length}`));
    };
    if (where.officeId !== undefined) push('"officeId" = ?', where.officeId);
    if (where.deleted !== undefined) push('deleted = ?', where.deleted);
    const createdAt = where.createdAt as { gte?: Date } | undefined;
    if (createdAt?.gte !== undefined) push('"createdAt" >= ?', createdAt.gte);
    return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
  }

  const counter = (table: string) => async (args: { where?: Record<string, unknown> }) => {
    const { sql, params } = buildWhere(args?.where);
    const res = await run(() => conn.query(`SELECT count(*)::int AS n FROM ${table}${sql}`, params));
    return res.rows[0].n as number;
  };

  return {
    subscription: {
      findMany: async (args: { where?: Record<string, unknown> }) => {
        const { sql, params } = buildWhere(args?.where);
        const res = await run(() => conn.query(
          `SELECT id, plan, status, "startDate", "endDate", "trialEndDate",
                  "currentPeriodStart", "currentPeriodEnd", "createdAt"
           FROM subscriptions${sql} ORDER BY "createdAt" DESC`,
          params,
        ));
        return res.rows;
      },
      findFirst: async () => null,
    },
    serviceOrder: { count: counter('service_orders') },
    client: { count: counter('clients') },
    part: { count: counter('parts') },
    // Prisma calls $queryRaw as a tagged template; translate to pg placeholders.
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      let sql = strings[0];
      for (let i = 0; i < values.length; i += 1) sql += `$${i + 1}${strings[i + 1]}`;
      const res = await run(() => conn.query(sql, values));
      return res.rows;
    },
  } as unknown as PlanStore;
}
