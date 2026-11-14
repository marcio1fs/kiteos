import type { Tx } from '@/lib/commercial';

/**
 * Single source of truth for commercial plans.
 *
 * Before this module the same table was copy-pasted into six routes, so the UI,
 * the checkout and the API could disagree about what a plan allows. Limits are
 * now resolved from the office's subscription record and enforced server-side at
 * creation time — hiding a button in the client is not authorization.
 */

export const UNLIMITED = -1;

export type PlanKey = 'FREE' | 'PRO' | 'PRO_PLUS' | 'PREMIUM';

export interface PlanDefinition {
  key: PlanKey;
  label: string;
  price: number;
  /** -1 means unlimited. */
  maxOS: number;
  maxClients: number;
  maxParts: number;
  aiAccess: boolean;
  whatsapp: boolean;
}

export const PLANS: Record<PlanKey, PlanDefinition> = {
  FREE: { key: 'FREE', label: 'Free', price: 0, maxOS: 10, maxClients: 20, maxParts: 50, aiAccess: false, whatsapp: false },
  PRO: { key: 'PRO', label: 'Pro', price: 99.90, maxOS: 100, maxClients: 200, maxParts: 500, aiAccess: true, whatsapp: false },
  PRO_PLUS: { key: 'PRO_PLUS', label: 'Pro+', price: 199.90, maxOS: 500, maxClients: 1000, maxParts: 2000, aiAccess: true, whatsapp: true },
  PREMIUM: { key: 'PREMIUM', label: 'Premium', price: 349.90, maxOS: UNLIMITED, maxClients: UNLIMITED, maxParts: UNLIMITED, aiAccess: true, whatsapp: true },
};

/** Ordered from cheapest to most capable. */
export const PLAN_KEYS: PlanKey[] = ['FREE', 'PRO', 'PRO_PLUS', 'PREMIUM'];

export const PLAN_HIERARCHY: Record<PlanKey, number> = { FREE: 0, PRO: 1, PRO_PLUS: 2, PREMIUM: 3 };

/**
 * Own-property check on purpose: `'__proto__' in PLANS` is true through the
 * prototype chain, and `PLANS['__proto__']` would hand back Object.prototype —
 * a "plan" with every limit undefined, which fails open as unlimited.
 */
export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PLANS, value);
}

/** Unknown or missing plan names always resolve to FREE — fail closed. */
export function getPlan(value: unknown): PlanDefinition {
  return isPlanKey(value) ? PLANS[value] : PLANS.FREE;
}

export type PlanResource = 'OS' | 'CLIENT' | 'PART';
export type PlanFeature = 'aiAccess' | 'whatsapp';

export type PlanErrorCode = 'PLAN_LIMIT_REACHED' | 'PLAN_FEATURE_UNAVAILABLE';

/** Business-rule failure for plan gating. Routes map it to 402 so the UI can upsell. */
export class PlanError extends Error {
  constructor(
    message: string,
    public readonly code: PlanErrorCode,
    public readonly detail: {
      status: number;
      plan: PlanKey;
      resource?: PlanResource;
      feature?: PlanFeature;
      current?: number;
      max?: number;
    },
  ) {
    super(message);
    this.name = 'PlanError';
  }

  get status() {
    return this.detail.status;
  }
}

export function isPlanError(error: unknown): error is PlanError {
  return error instanceof PlanError;
}

/**
 * Why the effective plan is what it is. Surfaced by the subscription endpoints so
 * an operator can tell "no subscription" from "expired" from "awaiting payment".
 */
export type PlanFallbackReason =
  | 'ACTIVE'
  | 'NONE'
  | 'PENDENTE'
  | 'CANCELADA'
  | 'TRIAL_EXPIRED'
  | 'ENDED'
  | 'UNKNOWN_STATUS';

export interface EffectivePlan {
  /** Limits actually in force right now. */
  plan: PlanDefinition;
  /** Plan written on the subscription row (may still be awaiting payment). */
  subscribedPlan: PlanKey;
  status: string;
  subscriptionId: string | null;
  /** Period start used to count service orders, or null to count all of them. */
  periodStart: Date | null;
  isOverdue: boolean;
  isPendingPayment: boolean;
  /** True when the office has no usable paid entitlement and fell back to FREE. */
  isFallback: boolean;
  reason: PlanFallbackReason;
}

/**
 * Guards accept a transaction client. `db` itself is assignable, but passing the
 * transaction is preferred: the limit count then shares the write's snapshot
 * instead of racing it.
 */
export type PlanStore = Tx;

/** Shape of Prisma's tagged-template raw query, used by the advisory lock. */
export type RawQuery = Tx['$queryRaw'];

/** Subscription statuses that keep the plan written on the row. */
const GRACE_STATUSES = new Set(['ATIVA', 'TRIAL', 'INADIMPLENTE']);

/** Precedence when an office has more than one subscription row. */
const STATUS_PRECEDENCE = ['ATIVA', 'TRIAL', 'INADIMPLENTE', 'PENDENTE', 'CANCELADA'];

function pickSubscription<T extends { status: string; createdAt: Date }>(rows: T[]): T | undefined {
  return rows.slice().sort((a, b) => {
    const ra = STATUS_PRECEDENCE.indexOf(a.status);
    const rb = STATUS_PRECEDENCE.indexOf(b.status);
    const pa = ra === -1 ? STATUS_PRECEDENCE.length : ra;
    const pb = rb === -1 ? STATUS_PRECEDENCE.length : rb;
    if (pa !== pb) return pa - pb;
    return b.createdAt.getTime() - a.createdAt.getTime();
  })[0];
}

/**
 * Resolve the plan whose limits apply to an office right now.
 *
 * Policy (fail closed — anything not explicitly granted is FREE):
 * - no subscription row, or every row soft-deleted ....... FREE  (NONE)
 * - status PENDENTE (checkout opened, payment not in) .... FREE  (PENDENTE)
 * - status CANCELADA .................................... FREE  (CANCELADA)
 * - status TRIAL with trialEndDate already past ......... FREE  (TRIAL_EXPIRED)
 * - endDate already past ................................ FREE  (ENDED)
 * - any other/unknown status ............................ FREE  (UNKNOWN_STATUS)
 * - ATIVA / TRIAL inside the period ..................... subscribed plan
 * - ATIVA / TRIAL past currentPeriodEnd, or INADIMPLENTE  subscribed plan, flagged
 *   `isOverdue`. A paying office in grace keeps working: blocking OS creation
 *   would also block the revenue that clears the debt. Turning grace into a hard
 *   stop after N days is a product decision and is deliberately not taken here.
 *
 * This function only reads. It never mutates the subscription row, so it is safe
 * to call inside the transaction that creates a record.
 */
export async function resolveEffectivePlan(
  store: PlanStore,
  officeId: string,
  now: Date = new Date(),
): Promise<EffectivePlan> {
  const rows = await store.subscription.findMany({
    where: { officeId, deleted: false },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      plan: true,
      status: true,
      startDate: true,
      endDate: true,
      trialEndDate: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      createdAt: true,
    },
  });

  const chosen = pickSubscription(rows);

  if (!chosen) {
    // No billing period exists yet, so service orders are counted all-time.
    // `/api/subscriptions/check` provisions the FREE row on the office's first
    // dashboard load, which is when period-based counting starts.
    return {
      plan: PLANS.FREE,
      subscribedPlan: 'FREE',
      status: 'NONE',
      subscriptionId: null,
      periodStart: null,
      isOverdue: false,
      isPendingPayment: false,
      isFallback: true,
      reason: 'NONE',
    };
  }

  const subscribedPlan = getPlan(chosen.plan);
  const base: EffectivePlan = {
    plan: subscribedPlan,
    subscribedPlan: subscribedPlan.key,
    status: chosen.status,
    subscriptionId: chosen.id,
    periodStart: chosen.currentPeriodStart ?? chosen.startDate ?? null,
    isOverdue: false,
    isPendingPayment: chosen.status === 'PENDENTE',
    isFallback: false,
    reason: 'ACTIVE',
  };

  const downgrade = (reason: PlanFallbackReason): EffectivePlan => ({
    ...base,
    plan: PLANS.FREE,
    isFallback: true,
    reason,
  });

  if (chosen.status === 'PENDENTE') return downgrade('PENDENTE');
  if (chosen.status === 'CANCELADA') return downgrade('CANCELADA');
  if (chosen.status === 'TRIAL' && chosen.trialEndDate && chosen.trialEndDate < now) {
    return downgrade('TRIAL_EXPIRED');
  }
  if (chosen.endDate && chosen.endDate < now) return downgrade('ENDED');
  if (!GRACE_STATUSES.has(chosen.status)) return downgrade('UNKNOWN_STATUS');

  const overdue =
    chosen.status === 'INADIMPLENTE' ||
    (!!chosen.currentPeriodEnd && chosen.currentPeriodEnd < now);

  return { ...base, isOverdue: overdue };
}

export interface PlanUsage {
  os: number;
  clients: number;
  parts: number;
}

/**
 * Count what the office already consumes. Service orders are counted per billing
 * period (matching what `/api/subscriptions/check` reports to the UI); clients
 * and parts are counted in total, because they are durable records.
 */
export async function countPlanUsage(
  store: PlanStore,
  officeId: string,
  periodStart: Date | null,
): Promise<PlanUsage> {
  const [os, clients, parts] = await Promise.all([
    store.serviceOrder.count({
      where: { officeId, deleted: false, ...(periodStart ? { createdAt: { gte: periodStart } } : {}) },
    }),
    store.client.count({ where: { officeId, deleted: false } }),
    store.part.count({ where: { officeId, deleted: false } }),
  ]);
  return { os, clients, parts };
}

const RESOURCE_LIMIT: Record<PlanResource, 'maxOS' | 'maxClients' | 'maxParts'> = {
  OS: 'maxOS',
  CLIENT: 'maxClients',
  PART: 'maxParts',
};

const RESOURCE_USAGE: Record<PlanResource, keyof PlanUsage> = {
  OS: 'os',
  CLIENT: 'clients',
  PART: 'parts',
};

const RESOURCE_LABEL: Record<PlanResource, string> = {
  OS: 'ordens de serviço',
  CLIENT: 'clientes',
  PART: 'peças',
};

const FEATURE_LABEL: Record<PlanFeature, string> = {
  aiAccess: 'o assistente de IA',
  whatsapp: 'o envio por WhatsApp',
};

/** A limit that is not a finite number denies access instead of granting it. */
export function isLimitReached(max: number, current: number): boolean {
  if (typeof max !== 'number' || !Number.isFinite(max)) return true;
  return max !== UNLIMITED && current >= max;
}

/**
 * Serialize limit checks per office.
 *
 * Counting rows and then inserting is a TOCTOU: under READ COMMITTED two
 * concurrent transactions both count 19, both insert, and the office ends up
 * over its 20-record limit. A transaction-scoped advisory lock keyed by the
 * office id makes every limited creation for that office wait in a single line,
 * so the count each one reads already includes the others' inserts.
 *
 * Why an advisory lock instead of `SELECT ... FOR UPDATE` on the office row:
 * the lock must exist even before any billable row does, and it must not depend
 * on a particular table staying present. `pg_advisory_xact_lock` is released
 * automatically by the COMMIT/ROLLBACK of the caller's transaction — there is no
 * unlock to forget. It is PostgreSQL-specific, which matches the datasource.
 *
 * Only taken when the plan actually has a ceiling: unlimited plans skip both the
 * lock and the counting.
 */
export async function lockOfficeForLimitCheck(store: PlanStore, officeId: string): Promise<void> {
  await store.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${officeId}, 0))`;
}

/**
 * Gate creation of a limited resource. Call it inside the same transaction that
 * creates the record so the count cannot go stale between check and write.
 * Throws PlanError (402) when the plan is full.
 */
export async function assertCanCreate(
  store: PlanStore,
  officeId: string,
  resource: PlanResource,
  now: Date = new Date(),
): Promise<{ effective: EffectivePlan; usage: PlanUsage }> {
  const effective = await resolveEffectivePlan(store, officeId, now);
  const max = effective.plan[RESOURCE_LIMIT[resource]];
  if (typeof max !== 'number' || !Number.isFinite(max)) {
    // Unreachable with a well-formed plan table; fail closed if it ever is not.
    throw new PlanError(
      'Plano da oficina inválido. Contate o suporte.',
      'PLAN_LIMIT_REACHED',
      { status: 402, plan: effective.plan.key, resource },
    );
  }
  if (max === UNLIMITED) {
    return { effective, usage: { os: 0, clients: 0, parts: 0 } };
  }

  await lockOfficeForLimitCheck(store, officeId);
  const usage = await countPlanUsage(store, officeId, effective.periodStart);
  const current = usage[RESOURCE_USAGE[resource]];
  if (!isLimitReached(max, current)) return { effective, usage };

  throw new PlanError(
    `Limite do plano ${effective.plan.label} atingido: ${current}/${max} ${RESOURCE_LABEL[resource]}. Faça upgrade para continuar.`,
    'PLAN_LIMIT_REACHED',
    { status: 402, plan: effective.plan.key, resource, current, max },
  );
}

/** Gate a paid feature (AI assistant, WhatsApp delivery). Throws PlanError (402). */
export async function assertFeature(
  store: PlanStore,
  officeId: string,
  feature: PlanFeature,
  now: Date = new Date(),
): Promise<EffectivePlan> {
  const effective = await resolveEffectivePlan(store, officeId, now);
  if (effective.plan[feature] === true) return effective;

  const target = PLAN_KEYS.find((key) => PLANS[key][feature]);
  throw new PlanError(
    `O plano ${effective.plan.label} não inclui ${FEATURE_LABEL[feature]}. Disponível a partir do plano ${target ? PLANS[target].label : 'superior'}.`,
    'PLAN_FEATURE_UNAVAILABLE',
    { status: 402, plan: effective.plan.key, feature },
  );
}

/**
 * Serialize a PlanError for a route response. `arrayShape` matches the
 * `{ errors: [...] }` envelope used by the AI route; everything else uses
 * `{ error: '...' }`.
 */
export function planErrorBody(error: PlanError, arrayShape = false) {
  const detail = {
    code: error.code,
    plan: error.detail.plan,
    ...(error.detail.resource ? { resource: error.detail.resource } : {}),
    ...(error.detail.feature ? { feature: error.detail.feature } : {}),
    ...(typeof error.detail.current === 'number' ? { current: error.detail.current } : {}),
    ...(typeof error.detail.max === 'number' ? { max: error.detail.max } : {}),
  };
  return {
    status: error.status,
    body: arrayShape
      ? { success: false, errors: [error.message], ...detail }
      : { success: false, error: error.message, ...detail },
  };
}

/** Limits/usage payload shared by the subscription endpoints. */
export async function buildPlanStatus(store: PlanStore, officeId: string, now: Date = new Date()) {
  const effective = await resolveEffectivePlan(store, officeId, now);
  const usage = await countPlanUsage(store, officeId, effective.periodStart);
  const { plan } = effective;
  return {
    effective,
    planDetails: plan,
    features: {
      maxOS: plan.maxOS,
      maxClients: plan.maxClients,
      maxParts: plan.maxParts,
      aiAccess: plan.aiAccess,
      whatsapp: plan.whatsapp,
    },
    currentUsage: usage,
    limitsReached: {
      os: isLimitReached(plan.maxOS, usage.os),
      clients: isLimitReached(plan.maxClients, usage.clients),
      parts: isLimitReached(plan.maxParts, usage.parts),
    },
  };
}

