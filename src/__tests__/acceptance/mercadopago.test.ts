import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';

const h = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(), findMany: vi.fn(async () => []),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'created', ...a.data })),
    update: vi.fn(async (a: { where: unknown; data: Record<string, unknown> }) => ({ ...(a.where as object), ...a.data })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  });
  const names = ['office', 'sale', 'saleItem', 'part', 'stockMovement', 'financialEntry', 'auditLog', 'subscription', 'notification', 'user', 'cashSession', 'sequencer', 'client'];
  const db: Record<string, ReturnType<typeof model>> = Object.fromEntries(names.map(n => [n, model()]));
  (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return { db, fetch: vi.fn() };
});
vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/token-encryption', () => ({ decryptToken: (v: unknown) => v }));

import { validateMpSignature } from '@/lib/mercadopago-webhook';
import { POST as webhook } from '@/app/api/mercadopago/webhook/route';

const secret = 'super-secret-webhook-key';
function sign(dataId: string, requestId: string, ts: number) {
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex');
  return `ts=${ts},v1=${v1}`;
}
function notification(paymentId: string, signature: string | null, requestId = 'req-1') {
  return new NextRequest(`https://test.invalid/api/mercadopago/webhook?data.id=${paymentId}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(signature ? { 'x-signature': signature, 'x-request-id': requestId } : {}) },
    body: JSON.stringify({ type: 'payment', action: 'payment.updated', data: { id: paymentId } }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', h.fetch);
  h.db.office.findMany.mockResolvedValue([{ id: 'office-A', mpAccessToken: 'token', mpWebhookSecret: secret, mpUserId: '999' }]);
  h.db.sale.findFirst.mockResolvedValue({ id: 'sale-A', officeId: 'office-A', number: 'A001', status: 'ABERTA', totalAmount: 100, discount: 0, items: [] });
  h.db.stockMovement.findFirst.mockResolvedValue({ id: 'mov-1' });
});

describe('Mercado Pago signature', () => {
  it('accepts the official id/request-id/ts manifest', () => {
    const ts = Date.now();
    expect(validateMpSignature({ xSignature: sign('123', 'req-1', ts), xRequestId: 'req-1', dataId: '123', secret })).toBe(true);
  });

  it('rejects the legacy ts.rawBody manifest', () => {
    const ts = Date.now();
    const body = '{"data":{"id":"123"}}';
    const v1 = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    expect(validateMpSignature({ xSignature: `ts=${ts},v1=${v1}`, xRequestId: 'req-1', dataId: '123', secret })).toBe(false);
  });

  it('rejects a stale timestamp', () => {
    const ts = Date.now() - 10 * 60 * 1000;
    expect(validateMpSignature({ xSignature: sign('123', 'req-1', ts), xRequestId: 'req-1', dataId: '123', secret })).toBe(false);
  });
});

describe('sale webhook', () => {
  it('rejects an invalid signature with 401 and never settles the sale', async () => {
    const res = await webhook(notification('123', 'ts=1,v1=bad'));
    expect(res.status).toBe(401);
    expect(h.db.sale.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an underpayment instead of marking the sale paid', async () => {
    const ts = Date.now();
    h.fetch.mockResolvedValue(new Response(JSON.stringify({
      id: 123, status: 'approved', transaction_amount: 50, currency_id: 'BRL',
      external_reference: 'A001', collector_id: 999,
    }), { status: 200 }));
    const res = await webhook(notification('123', sign('123', 'req-1', ts)));
    expect(res.status).toBe(409);
    expect(h.db.sale.updateMany).not.toHaveBeenCalled();
    expect(h.db.auditLog.create.mock.calls[0][0].data.action).toBe('PAYMENT_AMOUNT_MISMATCH');
  });

  it('settles a fully-paid sale exactly once via the status CAS', async () => {
    const ts = Date.now();
    h.fetch.mockResolvedValue(new Response(JSON.stringify({
      id: 123, status: 'approved', transaction_amount: 100, currency_id: 'BRL',
      external_reference: 'SALE:office-A:sale-A', collector_id: 999,
    }), { status: 200 }));
    const res = await webhook(notification('123', sign('123', 'req-1', ts)));
    expect(res.status).toBe(200);
    expect(h.db.sale.updateMany).toHaveBeenCalledTimes(1);
    expect(h.db.financialEntry.create).toHaveBeenCalledTimes(1);
  });
});
