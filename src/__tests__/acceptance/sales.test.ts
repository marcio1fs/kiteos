import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(), findMany: vi.fn(async () => []), findUnique: vi.fn(),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'created', ...a.data })),
    createMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async (a: { where: unknown; data: Record<string, unknown> }) => ({ ...(a.where as object), ...a.data })),
    updateMany: vi.fn(async () => ({ count: 1 })),
    upsert: vi.fn(async (a: { create: Record<string, unknown> }) => ({ ...a.create })),
  });
  const names = ['sale', 'saleItem', 'part', 'stockMovement', 'financialEntry', 'auditLog', 'client', 'user', 'cashSession', 'sequencer', 'notification'];
  const db: Record<string, ReturnType<typeof model>> = Object.fromEntries(names.map(n => [n, model()]));
  (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return { db, auth: vi.fn() };
});
vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/auth', () => ({ requireAuth: h.auth }));

import { POST as createSaleRoute } from '@/app/api/sales/route';
import { PUT as updateSaleRoute, DELETE as deleteSaleRoute } from '@/app/api/sales/[id]/route';
import { paySale, cancelSale, updateOpenSale, createSaleSchema } from '@/lib/sales';

const officeId = 'office-A';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function req(method: string, body?: unknown) {
  return new NextRequest('https://test.invalid/api/sales', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const openSale = {
  id: 'sale-A', officeId, number: 'A001', status: 'ABERTA', discount: 0, totalAmount: 100, deleted: false,
  items: [{ id: 'item-A', partId: 'part-A', quantity: 1, totalPrice: 100, unitPrice: 100, deleted: false }],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ payload: { userId: 'user-A', officeId, role: 'OWNER' } });
  h.db.sale.findFirst.mockResolvedValue(structuredClone(openSale));
  h.db.part.findFirst.mockResolvedValue({ id: 'part-A', officeId, description: 'Peça', quantity: 10, costPrice: 5, version: 1 });
  h.db.stockMovement.findFirst.mockResolvedValue({ id: 'mov-1' });
  h.db.user.findFirst.mockResolvedValue({ id: 'user-A', officeId, active: true });
  h.db.cashSession.findFirst.mockResolvedValue(null);
  h.db.sequencer.upsert.mockResolvedValue({ currentValue: 1 });
});

describe('sale creation validation', () => {
  it('rejects negative quantity at the schema boundary', () => {
    const parsed = createSaleSchema.safeParse({ officeId, items: [{ description: 'x', quantity: -2, unitPrice: 50 }] });
    expect(parsed.success).toBe(false);
  });

  it('POST /api/sales returns 400 for negative quantity and never creates a sale', async () => {
    const res = await createSaleRoute(req('POST', { officeId, items: [{ description: 'x', quantity: -2, unitPrice: 50 }], paymentMethod: 'PIX' }));
    expect(res.status).toBe(400);
    expect(h.db.sale.create).not.toHaveBeenCalled();
  });

  it('rejects discount greater than subtotal', async () => {
    const res = await createSaleRoute(req('POST', { officeId, discount: 200, items: [{ description: 'x', quantity: 1, unitPrice: 50 }], paymentMethod: 'PIX' }));
    expect(res.status).toBe(400);
    expect(h.db.sale.create).not.toHaveBeenCalled();
  });
});

describe('sale payment / cancellation integrity', () => {
  it('paySale is idempotent for an already-paid sale', async () => {
    h.db.sale.findFirst.mockResolvedValue({ ...openSale, status: 'PAGA' });
    const result = await paySale('sale-A', officeId, 'PIX', 'user-A');
    expect(result?.status).toBe('PAGA');
    expect(h.db.financialEntry.create).not.toHaveBeenCalled();
  });

  it('paySale claims the sale with a status CAS before creating the financial entry', async () => {
    await paySale('sale-A', officeId, 'PIX', 'user-A');
    const claim = h.db.sale.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 'sale-A', officeId, status: 'ABERTA' });
    expect(h.db.financialEntry.create).toHaveBeenCalledTimes(1);
    expect(h.db.financialEntry.create.mock.calls[0][0].data.saleId).toBe('sale-A');
  });

  it('cancelSale refuses to cancel a paid sale', async () => {
    h.db.sale.findFirst.mockResolvedValue({ ...openSale, status: 'PAGA' });
    await expect(cancelSale('sale-A', officeId, 'user-A')).rejects.toThrow(/estorno/);
    expect(h.db.sale.updateMany).not.toHaveBeenCalled();
  });

  it('updateOpenSale refuses to change values of a paid sale', async () => {
    h.db.sale.findFirst.mockResolvedValue({ ...openSale, status: 'PAGA' });
    await expect(updateOpenSale('sale-A', officeId, { discount: 90 })).rejects.toThrow(/imutáveis/);
  });

  it('PUT rejects unknown fields (no mass assignment)', async () => {
    const res = await updateSaleRoute(req('PUT', { totalAmount: 1 }), params('sale-A'));
    expect(res.status).toBe(400);
  });

  it('DELETE only hides cancelled sales', async () => {
    h.db.sale.updateMany.mockResolvedValue({ count: 0 });
    h.db.sale.findFirst.mockResolvedValue({ ...openSale, status: 'PAGA' });
    const res = await deleteSaleRoute(req('DELETE'), params('sale-A'));
    expect(res.status).toBe(409);
  });
});
