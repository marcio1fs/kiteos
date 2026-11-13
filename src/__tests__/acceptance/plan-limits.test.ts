import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Route-level enforcement of commercial plan limits.
 *
 * The client hides buttons when a plan is full; that is cosmetic. These tests
 * drive the real handlers and assert the API itself refuses the operation, with
 * 402 and a machine-readable code, before any record is written.
 */
const h = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'created', ...a.data })),
    update: vi.fn(async (a: { where: unknown; data: Record<string, unknown> }) => ({ ...(a.where as object), ...a.data })),
    updateMany: vi.fn(async () => ({ count: 1 })),
    upsert: vi.fn(async (a: { create: Record<string, unknown> }) => ({ currentValue: 1, ...a.create })),
  });
  const names = [
    'subscription', 'serviceOrder', 'serviceOrderItem', 'client', 'vehicle', 'part', 'mechanic',
    'supplier', 'stockMovement', 'notification', 'auditLog', 'office', 'aiChat', 'financialEntry', 'sequencer',
  ];
  const db: Record<string, ReturnType<typeof model>> = Object.fromEntries(names.map((n) => [n, model()]));
  (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction = vi.fn(
    async (fn: (tx: unknown) => unknown) => fn(db),
  );
  (db as unknown as { $queryRaw: ReturnType<typeof vi.fn> }).$queryRaw = vi.fn(async () => []);
  return { db, auth: vi.fn(), fetch: vi.fn(async () => new Response('{}', { status: 200 })) };
});

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/auth', () => ({ requireAuth: h.auth, auditLog: vi.fn(async () => undefined) }));

import { POST as createOS } from '@/app/api/service-orders/route';
import { POST as createClient } from '@/app/api/clients/route';
import { POST as createPart } from '@/app/api/parts/route';
import { POST as sendOsWhatsApp } from '@/app/api/whatsapp/send-os/route';
import { POST as aiChat } from '@/app/api/ai/chat/route';

const officeId = 'office-A';

function post(url: string, body: unknown) {
  return new NextRequest(`https://test.invalid${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function subscription(plan: string, status = 'ATIVA', extra: Record<string, unknown> = {}) {
  h.db.subscription.findMany.mockResolvedValue([
    {
      id: 'sub-1',
      plan,
      status,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: null,
      trialEndDate: null,
      currentPeriodStart: new Date('2026-11-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-12-01T00:00:00.000Z'),
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
      ...extra,
    },
  ]);
}

function usage({ os = 0, clients = 0, parts = 0 }) {
  h.db.serviceOrder.count.mockResolvedValue(os);
  h.db.client.count.mockResolvedValue(clients);
  h.db.part.count.mockResolvedValue(parts);
}

const osBody = {
  officeId,
  clientId: 'client-A',
  vehicleId: 'vehicle-A',
  description: 'Revisão',
  items: [{ type: 'SERVICO', description: 'Alinhamento', quantity: 1, unitPrice: 120 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.fetch = h.fetch as unknown as typeof fetch;
  h.auth.mockResolvedValue({ payload: { userId: 'user-A', officeId, role: 'OWNER' } });
  h.db.subscription.findMany.mockResolvedValue([]);
  h.db.client.findFirst.mockResolvedValue({ id: 'client-A', officeId, name: 'Cliente', phone: null, email: null });
  h.db.vehicle.findFirst.mockResolvedValue({ id: 'vehicle-A', officeId, clientId: 'client-A', plate: 'ABC1D23' });
  h.db.serviceOrder.findMany.mockResolvedValue([]);
  h.db.serviceOrder.create.mockImplementation(async (a: { data: Record<string, unknown> }) => ({
    id: 'os-new',
    number: 'A001',
    officeId,
    ...a.data,
  }));
  usage({ os: 0, clients: 0, parts: 0 });
});

describe('POST /api/service-orders', () => {
  it('creates the order while the plan has room', async () => {
    subscription('FREE');
    usage({ os: 9 });
    const res = await createOS(post('/api/service-orders', osBody));
    expect(res.status).toBe(201);
    expect(h.db.serviceOrder.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a new order once the FREE ceiling is hit, before writing anything', async () => {
    subscription('FREE');
    usage({ os: 10 });
    const res = await createOS(post('/api/service-orders', osBody));
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body).toMatchObject({ success: false, code: 'PLAN_LIMIT_REACHED', plan: 'FREE', resource: 'OS', current: 10, max: 10 });
    expect(h.db.serviceOrder.create).not.toHaveBeenCalled();
    expect(h.db.client.findFirst).not.toHaveBeenCalled();
    expect(h.db.sequencer.upsert).not.toHaveBeenCalled();
    expect(h.db.auditLog.create).not.toHaveBeenCalled();
  });

  it('refuses the paid plan an office has not paid for yet', async () => {
    subscription('PREMIUM', 'PENDENTE');
    usage({ os: 10 });
    const res = await createOS(post('/api/service-orders', osBody));
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body.plan).toBe('FREE');
    expect(h.db.serviceOrder.create).not.toHaveBeenCalled();
  });

  it('lets an unlimited plan through without counting', async () => {
    subscription('PREMIUM');
    usage({ os: 9999 });
    const res = await createOS(post('/api/service-orders', osBody));
    expect(res.status).toBe(201);
    expect(h.db.serviceOrder.count).not.toHaveBeenCalled();
  });

  it('checks the limit inside the write transaction, not before it', async () => {
    subscription('FREE');
    usage({ os: 10 });
    await createOS(post('/api/service-orders', osBody));
    expect(h.db.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/clients', () => {
  it('creates a client while the plan has room', async () => {
    subscription('FREE');
    usage({ clients: 19 });
    const res = await createClient(post('/api/clients', { officeId, name: 'Novo Cliente' }));
    expect(res.status).toBe(201);
    expect(h.db.client.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a client once the FREE ceiling is hit', async () => {
    subscription('FREE');
    usage({ clients: 20 });
    const res = await createClient(post('/api/clients', { officeId, name: 'Novo Cliente' }));
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', resource: 'CLIENT', current: 20, max: 20 });
    expect(h.db.client.create).not.toHaveBeenCalled();
  });

  it('refuses a client for an office whose subscription was cancelled', async () => {
    subscription('PRO_PLUS', 'CANCELADA');
    usage({ clients: 20 });
    const res = await createClient(post('/api/clients', { officeId, name: 'Novo Cliente' }));
    expect(res.status).toBe(402);
    expect((await res.json()).plan).toBe('FREE');
  });
});

describe('POST /api/parts', () => {
  it('creates a part while the plan has room', async () => {
    subscription('PRO');
    usage({ parts: 499 });
    const res = await createPart(post('/api/parts', { officeId, sku: 'OLEO-1', description: 'Óleo 5W30' }));
    expect(res.status).toBe(201);
    expect(h.db.part.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a part once the plan ceiling is hit', async () => {
    subscription('PRO');
    usage({ parts: 500 });
    const res = await createPart(post('/api/parts', { officeId, sku: 'OLEO-2', description: 'Óleo 10W40' }));
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body).toMatchObject({ code: 'PLAN_LIMIT_REACHED', plan: 'PRO', resource: 'PART', current: 500, max: 500 });
    expect(h.db.part.create).not.toHaveBeenCalled();
  });
});

describe('paid features are gated server-side', () => {
  it('refuses WhatsApp delivery on PRO and never calls the provider', async () => {
    subscription('PRO');
    const res = await sendOsWhatsApp(post('/api/whatsapp/send-os', { officeId, serviceOrderId: 'os-1' }));
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body).toMatchObject({ code: 'PLAN_FEATURE_UNAVAILABLE', plan: 'PRO', feature: 'whatsapp' });
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.db.office.findUnique).not.toHaveBeenCalled();
  });

  it('refuses WhatsApp delivery for an office with no subscription at all', async () => {
    const res = await sendOsWhatsApp(post('/api/whatsapp/send-os', { officeId, serviceOrderId: 'os-1' }));
    expect(res.status).toBe(402);
    expect((await res.json()).plan).toBe('FREE');
  });

  it('refuses the AI assistant on FREE and reads no office data', async () => {
    subscription('FREE');
    const res = await aiChat(post('/api/ai/chat', { officeId, message: 'Qual o diagnóstico?' }));
    const body = await res.json();
    expect(res.status).toBe(402);
    expect(body).toMatchObject({ success: false, code: 'PLAN_FEATURE_UNAVAILABLE', feature: 'aiAccess' });
    expect(Array.isArray(body.errors)).toBe(true);
    expect(h.db.office.findFirst).not.toHaveBeenCalled();
  });

  it('lets the AI assistant through on a plan that includes it', async () => {
    subscription('PRO');
    const res = await aiChat(post('/api/ai/chat', { officeId, message: 'Qual o diagnóstico?' }));
    expect(res.status).not.toBe(402);
  });
});
