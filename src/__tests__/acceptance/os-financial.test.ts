import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(), findMany: vi.fn(async () => []),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'created', ...a.data })),
    createMany: vi.fn(async () => ({ count: 1 })),
    update: vi.fn(async (a: { where: unknown; data: Record<string, unknown> }) => ({ ...(a.where as object), ...a.data })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  });
  const names = ['serviceOrder', 'serviceOrderItem', 'part', 'mechanic', 'stockMovement', 'financialEntry', 'auditLog', 'notification', 'client', 'vehicle'];
  const db: Record<string, ReturnType<typeof model>> = Object.fromEntries(names.map(n => [n, model()]));
  (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return { db, auth: vi.fn() };
});
vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/auth', () => ({ requireAuth: h.auth }));

import { PUT as updateOS } from '@/app/api/service-orders/[id]/route';
import { PUT as payFinancial } from '@/app/api/financial/pay/[id]/route';
import { DELETE as deleteFinancial } from '@/app/api/financial/[id]/route';

const officeId = 'office-A';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function put(body: unknown) {
  return new NextRequest('https://test.invalid/api/x', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
function del() { return new NextRequest('https://test.invalid/api/x', { method: 'DELETE' }); }

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ payload: { userId: 'user-A', officeId, role: 'OWNER' } });
  h.db.serviceOrder.findFirst.mockResolvedValue({
    id: 'os-A', officeId, number: 'A001', status: 'ABERTA', version: 1, totalDiscount: 0, totalParts: 0, totalServices: 0, totalAmount: 0,
    items: [{ id: 'item-A', officeId, serviceOrderId: 'os-A', type: 'SERVICO', description: 'Serviço', quantity: 1, unitPrice: 100, totalPrice: 100, commissionPct: 0, deleted: false }],
  });
  h.db.part.findFirst.mockResolvedValue({ id: 'part-A', officeId, description: 'Peça', quantity: 10, costPrice: 5, version: 1 });
  h.db.financialEntry.findFirst.mockResolvedValue({ id: 'fin-A', officeId, status: 'PENDENTE', totalAmount: 100, type: 'PAGAR', amount: 100, discount: 0, interest: 0, dueDate: new Date(), deleted: false });
});

describe('service order tenant isolation', () => {
  it('rejects an item ID that belongs to another order/tenant', async () => {
    const res = await updateOS(put({ items: [{ id: 'item-of-office-B', type: 'SERVICO', description: 'x', quantity: 1, unitPrice: 999 }] }), params('os-A'));
    expect(res.status).toBe(404);
    expect(h.db.serviceOrderItem.updateMany).not.toHaveBeenCalled();
    expect(h.db.part.updateMany).not.toHaveBeenCalled();
  });

  it('claims the order with a version CAS before touching items', async () => {
    const res = await updateOS(put({ items: [{ id: 'item-A', type: 'SERVICO', description: 'Serviço', quantity: 1, unitPrice: 120 }] }), params('os-A'));
    expect(res.status).toBe(200);
    const claim = h.db.serviceOrder.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 'os-A', officeId, version: 1 });
    const itemUpdate = h.db.serviceOrderItem.updateMany.mock.calls[0][0];
    expect(itemUpdate.where).toMatchObject({ id: 'item-A', serviceOrderId: 'os-A', officeId });
  });
});

describe('financial integrity', () => {
  it('marks an entry paid with a status CAS and writes the audit log in the same transaction', async () => {
    const res = await payFinancial(put({ paymentMethod: 'PIX' }), params('fin-A'));
    expect(res.status).toBe(200);
    const claim = h.db.financialEntry.updateMany.mock.calls[0][0];
    expect(claim.where).toMatchObject({ id: 'fin-A', officeId, status: { in: ['PENDENTE', 'ATRASADO'] } });
    expect(h.db.auditLog.create).toHaveBeenCalledTimes(1);
    expect(h.db.$transaction).toHaveBeenCalledTimes(1);
  });

  it('EMPLOYEE cannot approve payments', async () => {
    h.auth.mockResolvedValue({ payload: null, error: { status: 403, message: 'Permissão insuficiente' } });
    const res = await payFinancial(put({ paymentMethod: 'PIX' }), params('fin-A'));
    expect(res.status).toBe(403);
    expect(h.db.financialEntry.updateMany).not.toHaveBeenCalled();
  });

  it('refuses to delete a paid entry', async () => {
    h.db.financialEntry.findFirst.mockResolvedValue({ id: 'fin-A', officeId, status: 'PAGO', deleted: false });
    const res = await deleteFinancial(del(), params('fin-A'));
    expect(res.status).toBe(409);
    expect(h.db.financialEntry.updateMany).not.toHaveBeenCalled();
  });

  it('cancels an unpaid manual entry atomically', async () => {
    const res = await deleteFinancial(del(), params('fin-A'));
    expect(res.status).toBe(200);
    expect(h.db.financialEntry.updateMany.mock.calls[0][0].data).toMatchObject({ deleted: true, status: 'CANCELADO' });
  });
});
