import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * `/api/subscriptions/check` must report exactly the limits the API enforces.
 * These tests drive a small in-memory subscription table so the housekeeping
 * writes (auto-provision FREE, flag overdue, downgrade expired trial) are
 * visible to the second resolution the route performs.
 */
const h = vi.hoisted(() => {
  const state = {
    rows: [] as Array<Record<string, unknown>>,
    created: [] as Array<Record<string, unknown>>,
    updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
    counts: { os: 0, clients: 0, parts: 0 },
  };

  const subscription = {
    findMany: vi.fn(async (args: { where: { officeId: string; deleted: boolean } }) =>
      state.rows.filter((r) => r.officeId === args.where.officeId && r.deleted === false),
    ),
    findFirst: vi.fn(async (args: { where: { id?: string; officeId: string; deleted: boolean } }) =>
      state.rows.find(
        (r) => r.officeId === args.where.officeId && r.deleted === false && (args.where.id === undefined || r.id === args.where.id),
      ) ?? null,
    ),
    create: vi.fn(async (args: { data: Record<string, unknown> }) => {
      const row = { id: `sub-${state.rows.length + 1}`, deleted: false, ...args.data };
      state.rows.push(row);
      state.created.push(args.data);
      return row;
    }),
    update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = state.rows.find((r) => r.id === args.where.id);
      if (row) Object.assign(row, args.data);
      state.updates.push({ id: args.where.id, data: args.data });
      return row;
    }),
  };

  const db = {
    subscription,
    office: { findFirst: vi.fn(async () => ({ id: 'office-A' })) },
    serviceOrder: { count: vi.fn(async () => state.counts.os) },
    client: { count: vi.fn(async () => state.counts.clients) },
    part: { count: vi.fn(async () => state.counts.parts) },
  };

  return { state, db, auth: vi.fn() };
});

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/auth', () => ({ requireAuth: h.auth }));

import { GET as checkSubscription } from '@/app/api/subscriptions/check/route';

const officeId = 'office-A';

function get(queryOfficeId: string | null = officeId) {
  const url = queryOfficeId
    ? `https://test.invalid/api/subscriptions/check?officeId=${queryOfficeId}`
    : 'https://test.invalid/api/subscriptions/check';
  return new NextRequest(url, { method: 'GET' });
}

function seed(partial: Record<string, unknown>) {
  h.state.rows.push({
    id: 'sub-1',
    officeId,
    deleted: false,
    plan: 'PRO',
    status: 'ATIVA',
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: null,
    trialEndDate: null,
    currentPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...partial,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.state.rows = [];
  h.state.created = [];
  h.state.updates = [];
  h.state.counts = { os: 0, clients: 0, parts: 0 };
  h.db.office.findFirst.mockResolvedValue({ id: officeId });
  h.auth.mockResolvedValue({ payload: { userId: 'user-A', officeId, role: 'OWNER' } });
});

describe('tenant scoping', () => {
  it('rejects a missing officeId', async () => {
    const res = await checkSubscription(get(null));
    expect(res.status).toBe(400);
  });

  it('rejects an officeId that is not the caller tenant', async () => {
    const res = await checkSubscription(get('office-B'));
    expect(res.status).toBe(403);
    expect(h.db.subscription.findMany).not.toHaveBeenCalled();
  });

  it('rejects an unknown office', async () => {
    h.db.office.findFirst.mockResolvedValue(null);
    const res = await checkSubscription(get());
    expect(res.status).toBe(404);
  });

  it('propagates authentication failures', async () => {
    h.auth.mockResolvedValue({ payload: null, error: { message: 'Não autorizado', status: 401 } });
    const res = await checkSubscription(get());
    expect(res.status).toBe(401);
  });
});

describe('auto-provisioning', () => {
  it('creates a FREE subscription for an office that has none and reports FREE limits', async () => {
    h.state.counts = { os: 3, clients: 5, parts: 9 };
    const res = await checkSubscription(get());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(h.state.created).toHaveLength(1);
    expect(h.state.created[0]).toMatchObject({ officeId, plan: 'FREE', status: 'ATIVA', monthlyPrice: 0 });
    expect(body.data.effectivePlan).toBe('FREE');
    expect(body.data.features).toMatchObject({ maxOS: 10, maxClients: 20, maxParts: 50, aiAccess: false, whatsapp: false });
    expect(body.data.currentUsage).toEqual({ os: 3, clients: 5, parts: 9 });
    expect(body.data.limitsReached).toEqual({ os: false, clients: false, parts: false });
  });

  it('does not provision twice once the office already has a row', async () => {
    seed({ plan: 'PRO' });
    await checkSubscription(get());
    expect(h.state.created).toHaveLength(0);
  });
});

describe('reported limits match what the API enforces', () => {
  it('reports the subscribed plan while it is active and inside the period', async () => {
    seed({ plan: 'PRO_PLUS' });
    const body = await (await checkSubscription(get())).json();
    expect(body.data.effectivePlan).toBe('PRO_PLUS');
    expect(body.data.subscribedPlan).toBe('PRO_PLUS');
    expect(body.data.fallbackReason).toBe('ACTIVE');
    expect(body.data.isOverdue).toBe(false);
    expect(body.data.features.whatsapp).toBe(true);
  });

  it('reports FREE limits for a plan awaiting payment, and says which plan is pending', async () => {
    seed({ plan: 'PREMIUM', status: 'PENDENTE' });
    h.state.counts = { os: 10, clients: 0, parts: 0 };
    const body = await (await checkSubscription(get())).json();
    expect(body.data.effectivePlan).toBe('FREE');
    expect(body.data.subscribedPlan).toBe('PREMIUM');
    expect(body.data.isPendingPayment).toBe(true);
    expect(body.data.pendingPlan).toBe('PREMIUM');
    expect(body.data.fallbackReason).toBe('PENDENTE');
    expect(body.data.limitsReached.os).toBe(true);
  });

  it('reports FREE limits for a cancelled subscription', async () => {
    seed({ plan: 'PRO', status: 'CANCELADA' });
    const body = await (await checkSubscription(get())).json();
    expect(body.data.effectivePlan).toBe('FREE');
    expect(body.data.fallbackReason).toBe('CANCELADA');
  });
});

describe('billing housekeeping', () => {
  it('flags an elapsed period as overdue but keeps the paid limits (grace)', async () => {
    seed({ plan: 'PRO', status: 'ATIVA', currentPeriodEnd: new Date('2026-11-02T00:00:00.000Z') });
    const body = await (await checkSubscription(get())).json();

    expect(h.state.updates).toEqual([{ id: 'sub-1', data: { status: 'INADIMPLENTE' } }]);
    expect(body.data.billingStatus).toBe('INADIMPLENTE');
    expect(body.data.isOverdue).toBe(true);
    expect(body.data.effectivePlan).toBe('PRO');
    expect(body.data.features.maxOS).toBe(100);
  });

  it('downgrades an expired trial to FREE in the database, not only in the response', async () => {
    seed({ plan: 'PRO', status: 'TRIAL', trialEndDate: new Date('2026-11-01T00:00:00.000Z') });
    const body = await (await checkSubscription(get())).json();

    expect(h.state.updates).toHaveLength(1);
    expect(h.state.updates[0].data).toMatchObject({ status: 'ATIVA', plan: 'FREE', monthlyPrice: 0 });
    expect(body.data.effectivePlan).toBe('FREE');
    expect(body.data.features).toMatchObject({ maxOS: 10, aiAccess: false });
  });

  it('leaves a trial that has not expired alone', async () => {
    seed({ plan: 'PRO', status: 'TRIAL', trialEndDate: new Date('2026-12-01T00:00:00.000Z') });
    const body = await (await checkSubscription(get())).json();
    expect(h.state.updates).toHaveLength(0);
    expect(body.data.effectivePlan).toBe('PRO');
  });

  it('does not rewrite a subscription that is already INADIMPLENTE', async () => {
    seed({ plan: 'PRO', status: 'INADIMPLENTE' });
    const body = await (await checkSubscription(get())).json();
    expect(h.state.updates).toHaveLength(0);
    expect(body.data.isOverdue).toBe(true);
    expect(body.data.effectivePlan).toBe('PRO');
  });
});
