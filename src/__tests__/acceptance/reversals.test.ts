import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Estorno (reversal) acceptance tests — BIZ-05, BIZ-07 and PAY-06.
 *
 * The invariant under test is that a reversal PUTS MONEY AND STOCK BACK without
 * erasing history: the original launch stays in the books as ESTORNADO, a
 * compensating launch of the opposite type is written, and exactly one caller can
 * win the status transition.
 */
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

import { POST as saleEstornoRoute } from '@/app/api/sales/[id]/estorno/route';
import { POST as financialEstornoRoute } from '@/app/api/financial/[id]/estorno/route';
import { cancelSale, reverseSale, SALE_REVERSED_STATUS } from '@/lib/sales';
import {
  REVERSED_ENTRY_STATUS, oppositeEntryType, reversalReference, reverseFinancialEntry, systemActor,
} from '@/lib/reversals';
import { CommercialError } from '@/lib/commercial';

const officeId = 'office-A';
const otherOffice = 'office-B';
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function req(body?: unknown, method = 'POST') {
  return new NextRequest('https://test.invalid/api/estorno', {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const paidSale = {
  id: 'sale-A', officeId, number: 'A001', status: 'PAGA', discount: 0, totalAmount: 100,
  paymentMethod: 'PIX', paidAt: new Date(), deleted: false,
  items: [{ id: 'item-A', partId: 'part-A', quantity: 2, totalPrice: 100, unitPrice: 50, deleted: false, officeId }],
};

const paidEntry = {
  id: 'fin-A', officeId, type: 'RECEBER', category: 'PDV', description: 'Venda A001', status: 'PAGO',
  amount: 100, discount: 0, interest: 0, totalAmount: 100, paymentMethod: 'PIX',
  reference: 'A001', saleId: 'sale-A', supplierId: null, invoiceId: null, deleted: false,
  createdAt: new Date(),
};

/**
 * Dispatches findFirst by the shape of the WHERE clause, like the real queries do,
 * and is stateful: the flows read the entry BEFORE claiming it and again AFTER, so
 * the same `where: { id }` must return PAGO first and ESTORNADO once the CAS ran.
 * `null` is a meaningful value here (legacy sale with no launch), hence the `in`
 * checks instead of `??`.
 */
function wireFinancialEntries(opts: { existingReversal?: unknown; entry?: unknown; claimed?: unknown } = {}) {
  type Row = Record<string, unknown> | null;
  const entry = ('entry' in opts ? opts.entry : paidEntry) as Row;
  const claimed = ('claimed' in opts
    ? opts.claimed
    : entry ? { ...entry, status: REVERSED_ENTRY_STATUS } : null) as Row;
  let wasClaimed = false;
  h.db.financialEntry.updateMany.mockImplementation(async () => {
    wasClaimed = true;
    return { count: 1 };
  });
  h.db.financialEntry.findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    const reference = where.reference as string | undefined;
    if (typeof reference === 'string' && reference.startsWith('ESTORNO:')) return opts.existingReversal ?? null;
    if (where.id) return wasClaimed ? claimed : entry;
    return entry;
  });
}

function wireStock(opts: { returned?: boolean; deducted?: boolean } = {}) {
  h.db.stockMovement.findFirst.mockImplementation(async (args: { where?: Record<string, unknown> }) => {
    const where = args?.where ?? {};
    if (where.type === 'SAIDA') return opts.deducted === false ? null : { id: 'mov-out', type: 'SAIDA', quantity: 2 };
    if (where.type === 'ENTRADA') return opts.returned ? { id: 'mov-in', type: 'ENTRADA', quantity: 2 } : null;
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ payload: { userId: 'user-A', officeId, role: 'OWNER' } });
  h.db.sale.findFirst.mockResolvedValue(structuredClone(paidSale));
  h.db.sale.updateMany.mockResolvedValue({ count: 1 });
  h.db.part.findFirst.mockResolvedValue({ id: 'part-A', officeId, description: 'Peça', quantity: 5, costPrice: 10, version: 3 });
  h.db.part.updateMany.mockResolvedValue({ count: 1 });
  h.db.financialEntry.updateMany.mockResolvedValue({ count: 1 });
  h.db.stockMovement.create.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: 'mov-new', ...a.data }));
  h.db.financialEntry.create.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: 'fin-rev', ...a.data }));
  wireFinancialEntries();
  wireStock();
});

const owner = { userId: 'user-A', role: 'OWNER' };

describe('política de estorno', () => {
  it('inverte o tipo do lançamento e vincula a compensação ao original', () => {
    expect(oppositeEntryType('RECEBER')).toBe('PAGAR');
    expect(oppositeEntryType('PAGAR')).toBe('RECEBER');
    expect(() => oppositeEntryType('OUTRO')).toThrow(CommercialError);
    expect(reversalReference('fin-A')).toBe('ESTORNO:fin-A');
    expect(REVERSED_ENTRY_STATUS).toBe('ESTORNADO');
    expect(SALE_REVERSED_STATUS).toBe('ESTORNADA');
  });

  it('funcionário não estorna: 403 antes de qualquer acesso ao banco', async () => {
    await expect(reverseSale('sale-A', officeId, { userId: 'emp-1', role: 'EMPLOYEE' }, { reason: 'cliente desistiu' }))
      .rejects.toMatchObject({ status: 403 });
    expect(h.db.$transaction).not.toHaveBeenCalled();
    expect(h.db.financialEntry.create).not.toHaveBeenCalled();
  });

  it('ator de sistema (webhook assinado) pode estornar, e SYSTEM não vem de token', () => {
    const actor = systemActor('mercadopago-webhook');
    expect(actor).toEqual({ userId: 'mercadopago-webhook', role: 'SYSTEM' });
    return expect(reverseSale('sale-A', officeId, actor, { reason: 'refund MP' })).resolves.toBeTruthy();
  });
});

describe('estorno de venda paga', () => {
  it('marca ESTORNADA com CAS, devolve estoque e cria lançamento compensatório', async () => {
    const result = await reverseSale('sale-A', officeId, owner, { reason: 'cliente desistiu da compra' });

    expect(result.alreadyReversed).toBe(false);
    // CAS: a transição é a trava — só quem acha status PAGA vence.
    expect(h.db.sale.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'sale-A', officeId, status: 'PAGA', deleted: false }),
      data: { status: 'ESTORNADA' },
    }));
    // Estoque devolvido uma vez, com delta positivo e referência da venda.
    expect(h.db.part.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'part-A', officeId, version: 3 }),
    }));
    const movement = h.db.stockMovement.create.mock.calls[0][0].data;
    expect(movement).toMatchObject({ type: 'ENTRADA', partId: 'part-A', reference: 'SALE:sale-A' });
    expect(Number(movement.quantity)).toBe(2);
    // O original vira ESTORNADO; a compensação é do tipo oposto e fica paga.
    expect(h.db.financialEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'fin-A', officeId, status: 'PAGO' }),
      data: { status: 'ESTORNADO' },
    }));
    const reversal = h.db.financialEntry.create.mock.calls[0][0].data;
    expect(reversal).toMatchObject({
      type: 'PAGAR', status: 'PAGO', reference: 'ESTORNO:fin-A', saleId: 'sale-A', officeId,
      description: 'Estorno da venda A001',
    });
    expect(Number(reversal.totalAmount)).toBe(100);
    // Trilha de auditoria das duas pontas.
    const audits = h.db.auditLog.create.mock.calls.map(c => c[0].data);
    expect(audits.some(a => a.entity === 'Sale' && a.action === 'REVERSAL')).toBe(true);
    expect(audits.some(a => a.entity === 'FinancialEntry' && a.action === 'REVERSAL')).toBe(true);
    expect(audits.find(a => a.entity === 'Sale').details).toContain('cliente desistiu da compra');
  });

  it('não apaga nem reescreve o valor do lançamento original', async () => {
    await reverseSale('sale-A', officeId, owner, { reason: 'devolução' });
    expect(h.db.financialEntry.update).not.toHaveBeenCalled();
    // A única escrita no original é a transição de status: nenhum campo de valor.
    expect(h.db.financialEntry.updateMany).toHaveBeenCalledTimes(1);
    const write = h.db.financialEntry.updateMany.mock.calls[0][0];
    expect(write.data).toEqual({ status: 'ESTORNADO' });
    expect(write.where).toMatchObject({ id: 'fin-A', status: 'PAGO' });
  });

  it('perdedor da corrida leva 409 e não cria nada', async () => {
    h.db.sale.updateMany.mockResolvedValue({ count: 0 });
    await expect(reverseSale('sale-A', officeId, owner, { reason: 'cliente desistiu' }))
      .rejects.toMatchObject({ status: 409 });
    expect(h.db.financialEntry.create).not.toHaveBeenCalled();
    expect(h.db.part.updateMany).not.toHaveBeenCalled();
    expect(h.db.stockMovement.create).not.toHaveBeenCalled();
  });

  it('retry é idempotente: venda já ESTORNADA devolve o estorno existente sem criar outro', async () => {
    h.db.sale.findFirst.mockResolvedValue({ ...structuredClone(paidSale), status: 'ESTORNADA' });
    wireFinancialEntries({
      entry: { ...paidEntry, status: REVERSED_ENTRY_STATUS },
      existingReversal: { id: 'fin-rev', type: 'PAGAR', status: 'PAGO', reference: 'ESTORNO:fin-A', totalAmount: 100 },
    });

    const result = await reverseSale('sale-A', officeId, owner, { reason: 'retry do webhook' });

    expect(result.alreadyReversed).toBe(true);
    expect(result.reversal).toMatchObject({ id: 'fin-rev' });
    expect(h.db.sale.updateMany).not.toHaveBeenCalled();
    expect(h.db.financialEntry.create).not.toHaveBeenCalled();
    expect(h.db.stockMovement.create).not.toHaveBeenCalled();
  });

  it('não devolve estoque duas vezes quando a venda já teve ENTRADA registrada', async () => {
    wireStock({ returned: true });
    await reverseSale('sale-A', officeId, owner, { reason: 'devolução' });
    expect(h.db.part.updateMany).not.toHaveBeenCalled();
    expect(h.db.stockMovement.create).not.toHaveBeenCalled();
    // O dinheiro volta mesmo assim: estoque e financeiro são efeitos independentes.
    expect(h.db.financialEntry.create).toHaveBeenCalled();
  });

  it('venda aberta não tem o que estornar', async () => {
    h.db.sale.findFirst.mockResolvedValue({ ...structuredClone(paidSale), status: 'ABERTA' });
    await expect(reverseSale('sale-A', officeId, owner, { reason: 'desistência' }))
      .rejects.toMatchObject({ status: 409 });
    expect(h.db.sale.updateMany).not.toHaveBeenCalled();
  });

  it('venda cancelada não tem pagamento a estornar', async () => {
    h.db.sale.findFirst.mockResolvedValue({ ...structuredClone(paidSale), status: 'CANCELADA' });
    await expect(reverseSale('sale-A', officeId, owner, { reason: 'desistência' }))
      .rejects.toMatchObject({ status: 409 });
    expect(h.db.financialEntry.create).not.toHaveBeenCalled();
  });

  it('venda de outra oficina não existe: 404 sem tocar em nada', async () => {
    h.db.sale.findFirst.mockResolvedValue(null);
    await expect(reverseSale('sale-A', otherOffice, owner, { reason: 'desistência' }))
      .rejects.toMatchObject({ status: 404 });
    expect(h.db.sale.updateMany).not.toHaveBeenCalled();
  });

  it('venda paga sem lançamento financeiro (legado) ainda estorna estoque e status', async () => {
    wireFinancialEntries({ entry: null, claimed: null });
    const result = await reverseSale('sale-A', officeId, owner, { reason: 'legado sem financeiro' });
    expect(result.reversal).toBeNull();
    expect(h.db.sale.updateMany).toHaveBeenCalled();
    expect(h.db.stockMovement.create).toHaveBeenCalled();
    expect(h.db.financialEntry.create).not.toHaveBeenCalled();
  });

  it('depois do estorno a venda pode ser cancelada sem devolver estoque de novo', async () => {
    h.db.sale.findFirst.mockResolvedValue({ ...structuredClone(paidSale), status: 'ESTORNADA' });
    wireStock({ returned: true });

    await cancelSale('sale-A', officeId, 'user-A');

    expect(h.db.sale.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['ABERTA', 'ESTORNADA'] } }),
      data: { status: 'CANCELADA' },
    }));
    expect(h.db.part.updateMany).not.toHaveBeenCalled();
    // Lançamento estornado não é "cancelado" por cima: só pendentes/atrasados entram.
    expect(h.db.financialEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { in: ['PENDENTE', 'ATRASADO'] } }),
    }));
  });
});

describe('estorno de lançamento financeiro', () => {
  it('estorna um lançamento pago criando a compensação do tipo oposto', async () => {
    const manual = { ...paidEntry, id: 'fin-M', saleId: null, type: 'PAGAR', description: 'Aluguel' };
    wireFinancialEntries({ entry: manual, claimed: { ...manual, status: REVERSED_ENTRY_STATUS } });

    const result = await reverseFinancialEntry('fin-M', officeId, owner, { reason: 'pagamento duplicado' });

    expect(result.alreadyReversed).toBe(false);
    const reversal = h.db.financialEntry.create.mock.calls[0][0].data;
    expect(reversal).toMatchObject({ type: 'RECEBER', status: 'PAGO', reference: 'ESTORNO:fin-M', saleId: null });
    expect(h.db.financialEntry.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'fin-M', officeId, status: 'PAGO' }),
      data: { status: 'ESTORNADO' },
    }));
  });

  it('lançamento de venda é recusado aqui: o fluxo da venda devolve o estoque junto', async () => {
    await expect(reverseFinancialEntry('fin-A', officeId, owner, { reason: 'devolução' }))
      .rejects.toMatchObject({ status: 409 });
    expect(h.db.financialEntry.create).not.toHaveBeenCalled();
    expect(h.db.financialEntry.updateMany).not.toHaveBeenCalled();
  });

  it('lançamento pendente não é estornável', async () => {
    wireFinancialEntries({ entry: { ...paidEntry, id: 'fin-P', saleId: null, status: 'PENDENTE' } });
    await expect(reverseFinancialEntry('fin-P', officeId, owner, { reason: 'erro de lançamento' }))
      .rejects.toMatchObject({ status: 409 });
    expect(h.db.financialEntry.create).not.toHaveBeenCalled();
  });

  it('retry de um lançamento já estornado devolve a compensação existente', async () => {
    wireFinancialEntries({
      entry: { ...paidEntry, id: 'fin-M', saleId: null, status: REVERSED_ENTRY_STATUS },
      existingReversal: { id: 'fin-rev', reference: 'ESTORNO:fin-M' },
    });
    const result = await reverseFinancialEntry('fin-M', officeId, owner, { reason: 'retry' });
    expect(result.alreadyReversed).toBe(true);
    expect(result.reversal).toMatchObject({ id: 'fin-rev' });
    expect(h.db.financialEntry.create).not.toHaveBeenCalled();
  });

  it('perdedor da corrida no lançamento leva 409 sem criar compensação', async () => {
    wireFinancialEntries({ entry: { ...paidEntry, id: 'fin-M', saleId: null } });
    h.db.financialEntry.updateMany.mockResolvedValue({ count: 0 });
    await expect(reverseFinancialEntry('fin-M', officeId, owner, { reason: 'duplicado' }))
      .rejects.toMatchObject({ status: 409 });
    expect(h.db.financialEntry.create).not.toHaveBeenCalled();
  });

  it('valor não positivo não gera compensação', async () => {
    wireFinancialEntries({ entry: { ...paidEntry, id: 'fin-Z', saleId: null, totalAmount: 0 }, claimed: { ...paidEntry, id: 'fin-Z', saleId: null, totalAmount: 0, status: REVERSED_ENTRY_STATUS } });
    await expect(reverseFinancialEntry('fin-Z', officeId, owner, { reason: 'zerado' }))
      .rejects.toMatchObject({ status: 400 });
    expect(h.db.financialEntry.create).not.toHaveBeenCalled();
  });
});

describe('rotas de estorno', () => {
  it('POST /api/sales/[id]/estorno exige motivo', async () => {
    const res = await saleEstornoRoute(req({}), params('sale-A'));
    expect(res.status).toBe(400);
    expect(h.db.sale.updateMany).not.toHaveBeenCalled();
  });

  it('POST /api/sales/[id]/estorno rejeita motivo curto demais', async () => {
    const res = await saleEstornoRoute(req({ reason: 'x' }), params('sale-A'));
    expect(res.status).toBe(400);
  });

  it('POST /api/sales/[id]/estorno estorna e reporta o resultado', async () => {
    const res = await saleEstornoRoute(req({ reason: 'cliente desistiu' }), params('sale-A'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.alreadyReversed).toBe(false);
    expect(h.db.financialEntry.create).toHaveBeenCalled();
  });

  it('officeId vem do token, nunca do body', async () => {
    h.auth.mockResolvedValue({ payload: { userId: 'user-A', officeId, role: 'OWNER' } });
    await saleEstornoRoute(req({ reason: 'tentativa cross-tenant', officeId: otherOffice }), params('sale-A'));
    expect(h.db.sale.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ officeId }),
    }));
  });

  it('sem token não há estorno', async () => {
    h.auth.mockResolvedValue({ payload: null, error: { status: 401, message: 'Não autenticado' } });
    const res = await saleEstornoRoute(req({ reason: 'sem token' }), params('sale-A'));
    expect(res.status).toBe(401);
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it('conflito do serviço vira 409 na rota, não 500', async () => {
    h.db.sale.updateMany.mockResolvedValue({ count: 0 });
    const res = await saleEstornoRoute(req({ reason: 'corrida' }), params('sale-A'));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('POST /api/financial/[id]/estorno exige motivo e estorna', async () => {
    const bad = await financialEstornoRoute(req({}), params('fin-M'));
    expect(bad.status).toBe(400);

    wireFinancialEntries({ entry: { ...paidEntry, id: 'fin-M', saleId: null }, claimed: { ...paidEntry, id: 'fin-M', saleId: null, status: REVERSED_ENTRY_STATUS } });
    const ok = await financialEstornoRoute(req({ reason: 'pagamento duplicado' }), params('fin-M'));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.success).toBe(true);
    // O original é RECEBER/PAGO, então a compensação sai PAGAR/PAGO.
    expect(body.data.reversal).toMatchObject({ type: 'PAGAR', status: 'PAGO', reference: 'ESTORNO:fin-M' });
  });
});
