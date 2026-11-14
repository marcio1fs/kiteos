import { describe, expect, it, vi } from 'vitest';
import {
  PLANS,
  PlanError,
  assertCanCreate,
  assertFeature,
  buildPlanStatus,
  countPlanUsage,
  getPlan,
  isLimitReached,
  isPlanKey,
  isPlanError,
  planErrorBody,
  resolveEffectivePlan,
  type PlanStore,
} from '@/lib/plans';

const officeId = 'office-A';
const NOW = new Date('2026-11-05T12:00:00.000Z');

type Row = {
  id: string;
  plan: string;
  status: string;
  startDate: Date;
  endDate?: Date | null;
  trialEndDate?: Date | null;
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  createdAt: Date;
};

function row(partial: Partial<Row> & { plan?: string; status?: string } = {}): Row {
  return {
    id: 'sub-1',
    plan: 'PRO',
    status: 'ATIVA',
    startDate: new Date('2026-10-01T00:00:00.000Z'),
    endDate: null,
    trialEndDate: null,
    currentPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
    currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    ...partial,
  };
}

function store(rows: Row[], usage = { os: 0, clients: 0, parts: 0 }) {
  const counters = {
    serviceOrder: { count: vi.fn(async () => usage.os) },
    client: { count: vi.fn(async () => usage.clients) },
    part: { count: vi.fn(async () => usage.parts) },
  };
  const lock = vi.fn(async () => []);
  const s = {
    subscription: {
      findMany: vi.fn(async () => rows),
      findFirst: vi.fn(async () => rows[0] ?? null),
    },
    ...counters,
    $queryRaw: lock,
    calls: [] as string[],
  };
  // Record the order of operations: the row lock must precede the counting.
  for (const [name, fn] of Object.entries(counters)) {
    fn.count.mockImplementation(async () => {
      s.calls.push(`count:${name}`);
      return usage[name === 'serviceOrder' ? 'os' : name === 'client' ? 'clients' : 'parts'];
    });
  }
  lock.mockImplementation(async () => {
    s.calls.push('lock');
    return [];
  });
  return { store: s as unknown as PlanStore, counters, lock, calls: s.calls };
}

describe('plan table is the single source of truth', () => {
  it('exposes every plan with a fail-closed lookup', () => {
    expect(Object.keys(PLANS)).toEqual(['FREE', 'PRO', 'PRO_PLUS', 'PREMIUM']);
    expect(getPlan('PREMIUM').maxOS).toBe(-1);
    expect(getPlan('FREE').whatsapp).toBe(false);
    // Unknown or tampered plan names must never grant more than FREE.
    expect(getPlan('SUPER_SECRET')).toEqual(PLANS.FREE);
    expect(getPlan(undefined)).toEqual(PLANS.FREE);
    expect(getPlan('__proto__')).toEqual(PLANS.FREE);
    expect(getPlan('constructor')).toEqual(PLANS.FREE);
    expect(getPlan('toString')).toEqual(PLANS.FREE);
    expect(isPlanKey('__proto__')).toBe(false);
  });

  it('cannot be tricked into unlimited access by a poisoned plan name', async () => {
    // A subscription row carrying '__proto__' used to resolve to Object.prototype,
    // whose maxOS is undefined — and an undefined ceiling failed open.
    const { store: s } = store([row({ plan: '__proto__', status: 'ATIVA' })], { os: 10 });
    const effective = await resolveEffectivePlan(s, officeId, NOW);
    expect(effective.plan).toEqual(PLANS.FREE);
    const error = await assertCanCreate(s, officeId, 'OS', NOW).catch((e) => e);
    expect(isPlanError(error)).toBe(true);
    expect(error.detail).toMatchObject({ plan: 'FREE', resource: 'OS', max: 10 });
    await expect(assertFeature(s, officeId, 'aiAccess', NOW)).rejects.toMatchObject({
      code: 'PLAN_FEATURE_UNAVAILABLE',
      detail: { plan: 'FREE' },
    });
  });

  it('denies instead of granting when a limit is not a usable number', () => {
    expect(isLimitReached(undefined as unknown as number, 0)).toBe(true);
    expect(isLimitReached(Number.NaN, 0)).toBe(true);
  });

  it('treats -1 as unlimited and never as "zero allowed"', () => {
    expect(isLimitReached(-1, 999_999)).toBe(false);
    expect(isLimitReached(10, 9)).toBe(false);
    expect(isLimitReached(10, 10)).toBe(true);
  });
});

describe('effective plan resolution fails closed', () => {
  it('gives FREE to an office with no subscription', async () => {
    const { store: s } = store([]);
    const effective = await resolveEffectivePlan(s, officeId, NOW);
    expect(effective.plan.key).toBe('FREE');
    expect(effective.reason).toBe('NONE');
    expect(effective.isFallback).toBe(true);
    expect(effective.subscriptionId).toBeNull();
  });

  it('does not honour a plan whose payment is still pending', async () => {
    const { store: s } = store([row({ plan: 'PREMIUM', status: 'PENDENTE' })]);
    const effective = await resolveEffectivePlan(s, officeId, NOW);
    expect(effective.subscribedPlan).toBe('PREMIUM');
    expect(effective.plan.key).toBe('FREE');
    expect(effective.isPendingPayment).toBe(true);
    expect(effective.reason).toBe('PENDENTE');
  });

  it('drops a cancelled subscription back to FREE', async () => {
    const { store: s } = store([row({ plan: 'PRO_PLUS', status: 'CANCELADA' })]);
    const effective = await resolveEffectivePlan(s, officeId, NOW);
    expect(effective.plan.key).toBe('FREE');
    expect(effective.reason).toBe('CANCELADA');
  });

  it('drops an expired trial back to FREE', async () => {
    const { store: s } = store([
      row({ plan: 'PRO', status: 'TRIAL', trialEndDate: new Date('2026-11-04T00:00:00.000Z') }),
    ]);
    const effective = await resolveEffectivePlan(s, officeId, NOW);
    expect(effective.plan.key).toBe('FREE');
    expect(effective.reason).toBe('TRIAL_EXPIRED');
  });

  it('keeps a trial that has not expired yet', async () => {
    const { store: s } = store([
      row({ plan: 'PRO', status: 'TRIAL', trialEndDate: new Date('2026-11-20T00:00:00.000Z') }),
    ]);
    const effective = await resolveEffectivePlan(s, officeId, NOW);
    expect(effective.plan.key).toBe('PRO');
    expect(effective.reason).toBe('ACTIVE');
  });

  it('drops a subscription whose endDate has passed', async () => {
    const { store: s } = store([row({ plan: 'PRO', status: 'ATIVA', endDate: new Date('2026-11-01T00:00:00.000Z') })]);
    const effective = await resolveEffectivePlan(s, officeId, NOW);
    expect(effective.plan.key).toBe('FREE');
    expect(effective.reason).toBe('ENDED');
  });

  it('drops an unrecognised status instead of trusting it', async () => {
    const { store: s } = store([row({ plan: 'PREMIUM', status: 'PAGA_PARCIALMENTE' })]);
    const effective = await resolveEffectivePlan(s, officeId, NOW);
    expect(effective.plan.key).toBe('FREE');
    expect(effective.reason).toBe('UNKNOWN_STATUS');
  });

  it('keeps limits during grace but reports the office as overdue', async () => {
    const { store: s } = store([row({ plan: 'PRO', status: 'INADIMPLENTE' })]);
    const effective = await resolveEffectivePlan(s, officeId, NOW);
    expect(effective.plan.key).toBe('PRO');
    expect(effective.isOverdue).toBe(true);

    const { store: s2 } = store([
      row({ plan: 'PRO', status: 'ATIVA', currentPeriodEnd: new Date('2026-11-02T00:00:00.000Z') }),
    ]);
    const elapsed = await resolveEffectivePlan(s2, officeId, NOW);
    expect(elapsed.plan.key).toBe('PRO');
    expect(elapsed.isOverdue).toBe(true);
  });

  it('prefers the usable subscription when an office has several rows', async () => {
    const { store: s } = store([
      row({ id: 'sub-cancelled', plan: 'PRO', status: 'CANCELADA', createdAt: new Date('2026-11-04T00:00:00.000Z') }),
      row({ id: 'sub-active', plan: 'PRO_PLUS', status: 'ATIVA', createdAt: new Date('2026-10-01T00:00:00.000Z') }),
    ]);
    const effective = await resolveEffectivePlan(s, officeId, NOW);
    expect(effective.subscriptionId).toBe('sub-active');
    expect(effective.plan.key).toBe('PRO_PLUS');
  });

  it('never writes to the subscription while resolving limits', async () => {
    const { store: s } = store([row({ plan: 'PRO', status: 'INADIMPLENTE' })]);
    await resolveEffectivePlan(s, officeId, NOW);
    expect((s.subscription as unknown as { findMany: ReturnType<typeof vi.fn> }).findMany).toHaveBeenCalledTimes(1);
    expect(Object.keys(s.subscription)).toEqual(['findMany', 'findFirst']);
  });
});

describe('usage counting matches the billing window', () => {
  it('counts service orders from the current period only', async () => {
    const periodStart = new Date('2026-11-01T00:00:00.000Z');
    const { store: s, counters } = store([row({ currentPeriodStart: periodStart })]);
    const usage = await countPlanUsage(s, officeId, periodStart);
    expect(usage).toEqual({ os: 0, clients: 0, parts: 0 });
    expect(counters.serviceOrder.count.mock.calls[0][0].where).toMatchObject({
      officeId,
      deleted: false,
      createdAt: { gte: periodStart },
    });
    expect(counters.client.count.mock.calls[0][0].where).toMatchObject({ officeId, deleted: false });
    expect(counters.part.count.mock.calls[0][0].where).toMatchObject({ officeId, deleted: false });
  });

  it('counts every service order when there is no period to anchor to', async () => {
    const { store: s, counters } = store([]);
    await countPlanUsage(s, officeId, null);
    expect(counters.serviceOrder.count.mock.calls[0][0].where).toEqual({ officeId, deleted: false });
  });
});

describe('creation limits', () => {
  it('blocks the resource that hit the plan ceiling and says which one', async () => {
    const { store: s } = store([row({ plan: 'FREE', status: 'ATIVA' })], { os: 10, clients: 3, parts: 4 });
    const error = await assertCanCreate(s, officeId, 'OS', NOW).catch((e) => e);
    expect(isPlanError(error)).toBe(true);
    expect(error).toBeInstanceOf(PlanError);
    expect(error.status).toBe(402);
    expect(error.code).toBe('PLAN_LIMIT_REACHED');
    expect(error.detail).toMatchObject({ plan: 'FREE', resource: 'OS', current: 10, max: 10 });
  });

  it('allows creation while there is room, and blocks each resource independently', async () => {
    const { store: s } = store([row({ plan: 'FREE', status: 'ATIVA' })], { os: 9, clients: 20, parts: 50 });
    await expect(assertCanCreate(s, officeId, 'OS', NOW)).resolves.toBeDefined();
    await expect(assertCanCreate(s, officeId, 'CLIENT', NOW)).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', detail: { resource: 'CLIENT', current: 20, max: 20 } });
    await expect(assertCanCreate(s, officeId, 'PART', NOW)).rejects.toMatchObject({ detail: { resource: 'PART', current: 50, max: 50 } });
  });

  it('enforces FREE limits on an office whose upgrade was never paid', async () => {
    const { store: s } = store([row({ plan: 'PREMIUM', status: 'PENDENTE' })], { os: 10 });
    const error = await assertCanCreate(s, officeId, 'OS', NOW).catch((e) => e);
    expect(error.status).toBe(402);
    expect(error.detail.plan).toBe('FREE');
  });

  it('skips counting entirely on an unlimited plan', async () => {
    const { store: s, counters, lock } = store([row({ plan: 'PREMIUM', status: 'ATIVA' })], { os: 5000 });
    const result = await assertCanCreate(s, officeId, 'OS', NOW);
    expect(result.effective.plan.key).toBe('PREMIUM');
    expect(counters.serviceOrder.count).not.toHaveBeenCalled();
    expect(counters.client.count).not.toHaveBeenCalled();
    expect(counters.part.count).not.toHaveBeenCalled();
    // No ceiling means nothing to serialize, so no lock is taken.
    expect(lock).not.toHaveBeenCalled();
  });

  it('takes the per-office lock before counting, so concurrent creates cannot both pass', async () => {
    const { store: s, calls } = store([row({ plan: 'FREE', status: 'ATIVA' })], { os: 1, clients: 2, parts: 3 });
    await assertCanCreate(s, officeId, 'CLIENT', NOW);
    expect(calls[0]).toBe('lock');
    expect(calls.slice(1).sort()).toEqual(['count:client', 'count:part', 'count:serviceOrder']);
  });

  it('does not lock when the request is going to be refused anyway', async () => {
    // Feature gates do not count rows, so they must not take the office lock.
    const { store: s, lock } = store([row({ plan: 'FREE', status: 'ATIVA' })]);
    await expect(assertFeature(s, officeId, 'aiAccess', NOW)).rejects.toBeInstanceOf(PlanError);
    expect(lock).not.toHaveBeenCalled();
  });
});

describe('paid features', () => {
  it('refuses the AI assistant on FREE and PRO without it', async () => {
    const { store: free } = store([row({ plan: 'FREE', status: 'ATIVA' })]);
    const error = await assertFeature(free, officeId, 'aiAccess', NOW).catch((e) => e);
    expect(error.status).toBe(402);
    expect(error.code).toBe('PLAN_FEATURE_UNAVAILABLE');
    expect(error.detail).toMatchObject({ plan: 'FREE', feature: 'aiAccess' });
    expect(error.message).toContain('Pro');
  });

  it('grants the AI assistant from PRO up', async () => {
    const { store: pro } = store([row({ plan: 'PRO', status: 'ATIVA' })]);
    await expect(assertFeature(pro, officeId, 'aiAccess', NOW)).resolves.toMatchObject({ plan: { key: 'PRO' } });
  });

  it('refuses WhatsApp below PRO_PLUS and names the plan that unlocks it', async () => {
    const { store: pro } = store([row({ plan: 'PRO', status: 'ATIVA' })]);
    const error = await assertFeature(pro, officeId, 'whatsapp', NOW).catch((e) => e);
    expect(error.status).toBe(402);
    expect(error.detail.feature).toBe('whatsapp');
    expect(error.message).toContain('Pro+');
  });

  it('grants WhatsApp on PRO_PLUS', async () => {
    const { store: s } = store([row({ plan: 'PRO_PLUS', status: 'ATIVA' })]);
    await expect(assertFeature(s, officeId, 'whatsapp', NOW)).resolves.toMatchObject({ plan: { key: 'PRO_PLUS' } });
  });

  it('refuses both features while an upgrade is pending payment', async () => {
    const { store: s } = store([row({ plan: 'PREMIUM', status: 'PENDENTE' })]);
    await expect(assertFeature(s, officeId, 'aiAccess', NOW)).rejects.toMatchObject({ detail: { plan: 'FREE' } });
    await expect(assertFeature(s, officeId, 'whatsapp', NOW)).rejects.toMatchObject({ detail: { plan: 'FREE' } });
  });
});

describe('plan status payload', () => {
  it('reports limits, usage and which ones are reached', async () => {
    const { store: s } = store([row({ plan: 'FREE', status: 'ATIVA' })], { os: 10, clients: 4, parts: 50 });
    const status = await buildPlanStatus(s, officeId, NOW);
    expect(status.features).toEqual({ maxOS: 10, maxClients: 20, maxParts: 50, aiAccess: false, whatsapp: false });
    expect(status.currentUsage).toEqual({ os: 10, clients: 4, parts: 50 });
    expect(status.limitsReached).toEqual({ os: true, clients: false, parts: true });
    expect(status.effective.subscribedPlan).toBe('FREE');
  });
});

describe('error serialization', () => {
  it('emits the object envelope by default and the array envelope on request', () => {
    const error = new PlanError('Limite atingido', 'PLAN_LIMIT_REACHED', {
      status: 402,
      plan: 'FREE',
      resource: 'OS',
      current: 10,
      max: 10,
    });
    expect(planErrorBody(error)).toEqual({
      status: 402,
      body: { success: false, error: 'Limite atingido', code: 'PLAN_LIMIT_REACHED', plan: 'FREE', resource: 'OS', current: 10, max: 10 },
    });
    expect(planErrorBody(error, true).body).toMatchObject({ success: false, errors: ['Limite atingido'], code: 'PLAN_LIMIT_REACHED' });
  });

  it('omits usage fields for feature errors', () => {
    const error = new PlanError('Recurso indisponível', 'PLAN_FEATURE_UNAVAILABLE', { status: 402, plan: 'PRO', feature: 'whatsapp' });
    const body = planErrorBody(error).body as Record<string, unknown>;
    expect(body.current).toBeUndefined();
    expect(body.max).toBeUndefined();
    expect(body.feature).toBe('whatsapp');
  });
});
