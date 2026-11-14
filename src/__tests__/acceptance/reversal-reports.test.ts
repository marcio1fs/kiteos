/**
 * BIZ-05: a paid sale can no longer be edited or hard-deleted — it is reversed,
 * which flips the sale to ESTORNADA and its launch to ESTORNADO while creating a
 * compensatory launch. For that to be a real reversal, the reports must stop
 * counting the reversed money and start counting the compensation.
 *
 * These tests inspect the queries the report routes actually issue: no money
 * query may ever count an ESTORNADO launch as received/paid/outstanding, and no
 * cash-drawer query may ever count an ESTORNADA sale.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

type Call = { model: string; op: string; args: Record<string, unknown> };

const h = vi.hoisted(() => {
  const calls: { model: string; op: string; args: Record<string, unknown> }[] = [];

  const make = (name: string) => {
    const record = (op: string, fallback: unknown) => async (args?: Record<string, unknown>) => {
      calls.push({ model: name, op, args: args ?? {} });
      return fallback;
    };
    return {
      findFirst: record('findFirst', null),
      findMany: record('findMany', []),
      findUnique: record('findUnique', null),
      count: record('count', 0),
      aggregate: record('aggregate', { _sum: { totalAmount: 0, amount: 0 }, _count: { id: 0 } }),
      groupBy: record('groupBy', []),
      updateMany: record('updateMany', { count: 0 }),
      create: record('create', { id: 'generated' }),
      update: record('update', { id: 'updated' }),
      delete: record('delete', { id: 'deleted' }),
    };
  };

  const names = ['financialEntry', 'sale', 'cashSession', 'cashMovement', 'auditLog', 'user'];
  const db = Object.fromEntries(names.map((n) => [n, make(n)])) as Record<string, ReturnType<typeof make>>;

  // An open drawer, so the cash-register route reaches its sale queries.
  db.cashSession.findFirst = (async (args?: Record<string, unknown>) => {
    calls.push({ model: 'cashSession', op: 'findFirst', args: args ?? {} });
    return {
      id: 'session-1',
      officeId: 'office-A',
      userId: 'user-A',
      status: 'ABERTO',
      openingAmount: 100,
      closedAt: null,
      user: { id: 'user-A', name: 'Vendedor', email: 'v@test.invalid' },
      movements: [],
    };
  }) as typeof db.cashSession.findFirst;

  return { calls, db, auth: vi.fn(), auditLog: vi.fn(async () => undefined) };
});

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/auth', () => ({ requireAuth: h.auth, auditLog: h.auditLog }));

import { GET as dashboard } from '@/app/api/financial/dashboard/route';
import { GET as cashRegister } from '@/app/api/cash-register/route';

const officeId = 'office-A';

function get(path: string) {
  return new NextRequest(`https://test.invalid${path}?officeId=${officeId}`, { method: 'GET' });
}

/** Every status value a where-clause restricts to, flattened. */
function statusFilter(where: unknown): string[] | null {
  const status = (where as { status?: unknown } | undefined)?.status;
  if (status === undefined) return null;
  if (typeof status === 'string') return [status];
  const list = (status as { in?: unknown }).in;
  return Array.isArray(list) ? (list as string[]) : [];
}

const READ_OPS = ['findMany', 'aggregate', 'groupBy', 'count'];
const readCalls = (model: string) =>
  (h.calls as Call[]).filter((c) => c.model === model && READ_OPS.includes(c.op));

beforeEach(() => {
  vi.clearAllMocks();
  (h.calls as Call[]).length = 0;
  h.auth.mockResolvedValue({ payload: { userId: 'user-A', officeId, role: 'OWNER' } });
});

describe('relatórios financeiros ignoram o que foi estornado', () => {
  it('nenhuma leitura de lançamento conta ESTORNADO como dinheiro', async () => {
    const res = await dashboard(get('/api/financial/dashboard'));
    expect(res.status).toBe(200);

    const money = readCalls('financialEntry').filter((c) => statusFilter(c.args.where) !== null);
    expect(money.length).toBeGreaterThan(0);

    for (const call of money) {
      const statuses = statusFilter(call.args.where);
      expect(statuses, `${call.op} não pode contar ESTORNADO`).not.toContain('ESTORNADO');
    }
  });

  it('o caixa realizado só considera lançamentos PAGOS (o estorno sai, a compensação entra)', async () => {
    const res = await dashboard(get('/api/financial/dashboard'));
    expect(res.status).toBe(200);

    const realized = readCalls('financialEntry').filter((c) => {
      const statuses = statusFilter(c.args.where);
      return statuses !== null && statuses.includes('PAGO');
    });
    expect(realized.length).toBeGreaterThan(0);
    for (const call of realized) {
      expect(statusFilter(call.args.where)).toEqual(['PAGO']);
    }
  });

  it('a atualização automática de atraso não ressuscita um lançamento estornado', async () => {
    await dashboard(get('/api/financial/dashboard'));

    const sweeps = (h.calls as Call[]).filter((c) => c.model === 'financialEntry' && c.op === 'updateMany');
    expect(sweeps.length).toBeGreaterThan(0);
    for (const sweep of sweeps) {
      expect(statusFilter(sweep.args.where)).not.toContain('ESTORNADO');
      expect((sweep.args.data as { status?: string }).status).not.toBe('ESTORNADO');
    }
  });
});

describe('caixa ignora venda estornada', () => {
  it('nenhuma leitura de venda no caixa aceita status diferente de PAGA', async () => {
    const res = await cashRegister(get('/api/cash-register'));
    expect(res.status).toBe(200);

    const sales = readCalls('sale');
    expect(sales.length).toBeGreaterThan(0);
    for (const call of sales) {
      expect(statusFilter(call.args.where), `${call.op} precisa filtrar por PAGA`).toEqual(['PAGA']);
    }
  });
});
