/**
 * SONDAS DE AUDITORIA — caracterizam defeitos, não são testes de aceitação.
 * Cada teste PASSA quando o comportamento inseguro atual é reproduzido.
 * Banco, autenticação e rede são simulados; nenhuma operação externa é executada.
 * Após correções, estes testes devem ser substituídos por testes que exigem o comportamento seguro.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHmac } from 'node:crypto';

const h = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(async () => []),
    count: vi.fn(async () => 0), aggregate: vi.fn(),
    create: vi.fn(async (a: any) => ({ id: 'created-id', ...a.data })),
    createMany: vi.fn(async (a: any) => ({ count: a.data?.length ?? 0 })),
    update: vi.fn(async (a: any) => ({ id: a.where.id, ...a.data })),
    updateMany: vi.fn(async () => ({ count: 1 })),
    delete: vi.fn(), deleteMany: vi.fn(async () => ({ count: 0 })),
  });
  const names = ['sale','saleItem','part','stockMovement','financialEntry','auditLog','notification','serviceOrder','serviceOrderItem','subscription','office','nfseServico','client','user','refreshToken','tokenBlacklist','invoice','invoiceItem','reception','supplier','spedRegistro','taxRule'];
  const db: any = Object.fromEntries(names.map(n => [n, model()]));
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return { db, auth: vi.fn(), fetch: vi.fn() };
});
vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/auth', () => ({ requireAuth: h.auth, auditLog: vi.fn() }));
vi.mock('@/lib/audit', () => ({ createAuditLog: vi.fn() }));
vi.mock('@/lib/token-encryption', () => ({ decryptToken: (v: any) => v, encryptToken: (v: any) => v }));

import { POST as pdv } from '@/app/api/pdv/route';
import { PUT as updateSale, DELETE as deleteSale } from '@/app/api/sales/[id]/route';
import { PUT as updateOS } from '@/app/api/service-orders/[id]/route';
import { PUT as updateSubscription } from '@/app/api/subscriptions/[id]/route';
import { POST as mpWebhook } from '@/app/api/mercadopago/webhook/route';
import { POST as createNfse } from '@/app/api/nfse/route';
import { POST as sendNotification } from '@/app/api/notifications/send/route';
import { POST as stockMovement } from '@/app/api/stock-movements/route';
import { DELETE as deleteFinancial } from '@/app/api/financial/[id]/route';
import { createImportJob, processImportJob, getImportJob } from '@/lib/sefaz/import-queue';

const officeId = 'office-A';
const params = (id = 'record-A') => ({ params: Promise.resolve({ id }) });
function req(path: string, body?: unknown, headers: Record<string,string> = {}) {
  return new NextRequest(`https://audit.invalid${path}`, {
    method: body === undefined ? 'DELETE' : 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function put(path: string, body: unknown) {
  return new NextRequest(`https://audit.invalid${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
const part = { id: 'part-A', officeId, description: 'Peça A', quantity: 10, costPrice: 5, deleted: false };
const sale = { id: 'sale-A', officeId, number: 'A0001', status: 'PAGA', totalAmount: 100, discount: 0, deleted: false, items: [{ id: 'item-A', partId: 'part-A', quantity: 1, totalPrice: 100 }] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', h.fetch);
  h.auth.mockResolvedValue({ payload: { userId: 'user-A', officeId, role: 'OWNER' }, error: null });
  h.db.$transaction.mockImplementation(async (fn: any) => fn(h.db));
  h.db.sale.count.mockResolvedValue(0);
  h.db.sale.findFirst.mockResolvedValue(structuredClone(sale));
  h.db.office.findMany.mockResolvedValue([]);
  h.db.financialEntry.findFirst.mockResolvedValue(null);
  h.fetch.mockReset();
  h.db.part.findFirst.mockResolvedValue({ ...part });
  h.db.part.findUnique.mockResolvedValue({ ...part });
  h.db.office.findUnique.mockResolvedValue({ id: officeId, name: 'Oficina A', cnpj: '12345678000190', state: 'BA', city: 'Salvador', waEnabled: false });
});

describe('Sondas de regras comerciais (defeitos esperados nesta revisão)', () => {
  it('PDV aceita quantidade negativa, total negativo e aumenta o estoque', async () => {
    const res = await pdv(req('/api/pdv', { officeId, items: [{ partId: 'part-A', description: 'Peça A', quantity: -2, unitPrice: 50 }], paymentMethod: 'DINHEIRO' }));
    expect(res.status).toBe(201);
    expect(h.db.sale.create.mock.calls[0][0].data.items.create[0].totalPrice).toBe(-100);
    expect(h.db.sale.create.mock.calls[0][0].data.totalAmount).toBe(0);
    expect(h.db.part.update.mock.calls[0][0].data.quantity).toBe(12);
  });

  it('PDV mascara venda acima do saldo transformando estoque em zero', async () => {
    h.db.part.findFirst.mockResolvedValueOnce({ ...part, quantity: 10 }).mockResolvedValueOnce({ ...part, quantity: 1 });
    const res = await pdv(req('/api/pdv', { officeId, items: [{ partId: 'part-A', description: 'Peça A', quantity: 5, unitPrice: 50 }], paymentMethod: 'PIX' }));
    expect(res.status).toBe(201);
    expect(h.db.part.update.mock.calls[0][0].data.quantity).toBe(0);
    expect(h.db.stockMovement.create.mock.calls[0][0].data.quantity).toBe(5);
  });

  it('Alterar desconto de venda PAGA não sincroniza o lançamento financeiro', async () => {
    const res = await updateSale(put('/api/sales/sale-A', { discount: 90 }), params('sale-A'));
    expect(res.status).toBe(200);
    expect(h.db.sale.update.mock.calls[0][0].data.totalAmount).toBe(10);
    expect(h.db.financialEntry.update).not.toHaveBeenCalled();
    expect(h.db.financialEntry.updateMany).not.toHaveBeenCalled();
  });

  it('Excluir venda PAGA apenas oculta a venda, sem estornar financeiro/estoque', async () => {
    const res = await deleteSale(req('/api/sales/sale-A'), params('sale-A'));
    expect(res.status).toBe(200);
    expect(h.db.sale.update.mock.calls[0][0].data).toEqual({ deleted: true });
    expect(h.db.financialEntry.updateMany).not.toHaveBeenCalled();
    expect(h.db.stockMovement.create).not.toHaveBeenCalled();
  });

  it('OS permite atualizar item de outro tenant usando somente o ID do item', async () => {
    h.db.serviceOrder.findFirst.mockResolvedValue({ id: 'os-A', officeId, number: 'OS-A', status: 'ABERTA', totalDiscount: 0, totalParts: 0, totalServices: 0, items: [] });
    const res = await updateOS(put('/api/service-orders/os-A', { items: [{ id: 'item-of-office-B', type: 'SERVICO', description: 'Alteração indevida', quantity: 1, unitPrice: 999 }] }), params('os-A'));
    expect(res.status).toBe(200);
    expect(h.db.serviceOrderItem.update.mock.calls[0][0].where).toEqual({ id: 'item-of-office-B' });
    expect(h.db.serviceOrderItem.update.mock.calls[0][0].data.totalPrice).toBe(999);
  });

  it('Movimentação de estoque usa saldo lido antes da transação e sobrescreve saldo concorrente', async () => {
    // A leitura externa vê 10; outra operação já gravou 4 antes do update desta requisição.
    h.db.part.findFirst.mockResolvedValue({ ...part, quantity: 10 });
    const res = await stockMovement(req('/api/stock-movements', { officeId, partId: 'part-A', type: 'SAIDA', quantity: 3 }));
    expect(res.status).toBe(201);
    expect(h.db.part.update.mock.calls[0][0].data.quantity).toBe(7); // sobrescreve o saldo 4
    expect(h.db.part.updateMany).not.toHaveBeenCalled();
  });

  it('EMPLOYEE pode excluir lançamento financeiro PAGO sem estorno', async () => {
    h.auth.mockResolvedValue({ payload: { userId: 'user-A', officeId, role: 'EMPLOYEE' }, error: null });
    h.db.financialEntry.findFirst.mockResolvedValue({ id: 'fin-A', officeId, status: 'PAGO', totalAmount: 100, deleted: false });
    const res = await deleteFinancial(req('/api/financial/fin-A'), params('fin-A'));
    expect(res.status).toBe(200);
    expect(h.db.financialEntry.update.mock.calls[0][0].data).toEqual({ deleted: true });
  });

  it('OWNER de assinatura ATIVA troca FREE por PREMIUM sem pagamento confirmado', async () => {
    h.db.subscription.findFirst.mockResolvedValue({ id: 'sub-A', officeId, plan: 'FREE', status: 'ATIVA', monthlyPrice: 0, currentPeriodStart: null, currentPeriodEnd: null });
    h.db.subscription.update.mockImplementation(async (a: any) => ({ id: 'sub-A', officeId, status: 'ATIVA', ...a.data }));
    const res = await updateSubscription(put('/api/subscriptions/sub-A', { plan: 'PREMIUM' }), params('sub-A'));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.plan).toBe('PREMIUM');
    expect(json.data.status).toBe('ATIVA');
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe('Sondas de integrações (rede simulada)', () => {
  it('Webhook aprova venda de R$100 com pagamento de R$1', async () => {
    const body = JSON.stringify({ type: 'payment', data: { id: 'pay-1' } });
    const ts = String(Date.now());
    const secret = 'audit-secret';
    const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    h.db.office.findMany.mockResolvedValue([{ id: officeId, mpAccessToken: 'token', mpWebhookSecret: secret }]);
    h.db.sale.findFirst.mockResolvedValue({ ...sale, status: 'ABERTA' });
    h.fetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'pay-1', status: 'approved', transaction_amount: 1, currency_id: 'BRL', external_reference: 'A0001' }) });
    const res = await mpWebhook(req('/api/mercadopago/webhook?data.id=pay-1', { type: 'payment', data: { id: 'pay-1' } }, { 'x-signature': `ts=${ts},v1=${sig}`, 'x-request-id': 'request-1' }));
    expect(res.status).toBe(200);
    expect(h.db.sale.update.mock.calls[0][0].data.status).toBe('PAGA');
  });

  it('Webhook rejeita assinatura válida no formato oficial do Mercado Pago', async () => {
    const ts = String(Date.now());
    const secret = 'audit-secret';
    const manifest = `id:pay-1;request-id:request-1;ts:${ts};`;
    const sig = createHmac('sha256', secret).update(manifest).digest('hex');
    h.db.office.findMany.mockResolvedValue([{ id: officeId, mpAccessToken: 'token', mpWebhookSecret: secret }]);
    const res = await mpWebhook(req('/api/mercadopago/webhook?data.id=pay-1', { type: 'payment', data: { id: 'pay-1' } }, { 'x-signature': `ts=${ts},v1=${sig}`, 'x-request-id': 'request-1' }));
    expect(res.status).toBe(200); // ACK genérico após ignorar a única oficina: perda silenciosa.
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('Fila assíncrona declara importação concluída sem consultar SEFAZ ou gravar nota', async () => {
    const job = createImportJob('0'.repeat(44), officeId, 'user-A');
    await processImportJob(job.id);
    expect(getImportJob(job.id)?.status).toBe('COMPLETED');
    expect((getImportJob(job.id)?.result as any)?.message).toBe('Importação processada com sucesso');
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.db.invoice.create).not.toHaveBeenCalled();
  });

  it('E-mail não integrado é persistido como ENVIADA', async () => {
    h.db.notification.findFirst.mockResolvedValue({ id: 'created-id', status: 'ENVIADA' });
    const res = await sendNotification(req('/api/notifications/send', { officeId, type: 'EMAIL', title: 'Teste', message: 'Teste', recipient: 'test@example.invalid' }));
    expect(res.status).toBe(201);
    expect(h.db.notification.update.mock.calls[0][0].data.status).toBe('ENVIADA');
    expect(h.fetch).not.toHaveBeenCalled();
  });

  it('NFS-e é persistida como EMITIDA sem transmissão ao município', async () => {
    h.db.nfseServico.findFirst.mockResolvedValue(null);
    const res = await createNfse(req('/api/nfse', { officeId, discriminacao: 'Manutenção', valorServicos: 100, clienteNome: 'Cliente A', competencia: '2026-11' }));
    expect(res.status).toBe(201);
    expect(h.db.nfseServico.create.mock.calls[0][0].data.status).toBe('EMITIDA');
    expect(h.fetch).not.toHaveBeenCalled();
  });
});
