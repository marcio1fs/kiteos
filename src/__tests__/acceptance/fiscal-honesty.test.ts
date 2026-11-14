/**
 * Passo 5 — fim dos status fiscais fictícios (FISC-01, FISC-02, FISC-04, NOT-01).
 *
 * A regra que estes testes exigem: nenhum documento pode ser gravado como
 * emitido/autorizado/concluído sem que uma autoridade externa tenha respondido.
 * Sem integração configurada, o sistema diz que não integrou — e o registro
 * permanece num estado que não mente.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const h = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(async () => []),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'created-id', ...a.data })),
    update: vi.fn(async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({ ...a.where, ...a.data })),
    updateMany: vi.fn(async () => ({ count: 1 })),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    aggregate: vi.fn(async () => ({ _sum: { totalAmount: 0 }, _count: { id: 0 } })),
    count: vi.fn(async () => 0),
  });
  const names = [
    'nfseServico', 'clientInvoice', 'notification', 'office', 'invoice', 'invoiceItem',
    'certificadoDigital', 'supplier', 'reception', 'sefazConsulta', 'taxRule', 'part',
    'auditLog', 'spedRegistro', 'client', 'serviceOrder', 'user',
  ];
  const db = Object.fromEntries(names.map((n) => [n, model()])) as Record<string, ReturnType<typeof model>>;
  return {
    db,
    auth: vi.fn(),
    auditLog: vi.fn(async () => undefined),
    createAuditLog: vi.fn(async () => undefined),
    resolveNfseProvider: vi.fn(),
    importNfeByChave: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/auth', () => ({ requireAuth: h.auth, auditLog: h.auditLog }));
vi.mock('@/lib/audit', () => ({ createAuditLog: h.createAuditLog }));
vi.mock('@/lib/fiscal/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/fiscal/provider')>('@/lib/fiscal/provider');
  return { ...actual, resolveNfseProvider: h.resolveNfseProvider };
});
vi.mock('@/lib/sefaz/nfe-import', () => ({ importNfeByChave: h.importNfeByChave }));

import { POST as createNfse } from '@/app/api/nfse/route';
import { DELETE as deleteNfse } from '@/app/api/nfse/[id]/route';
import { POST as transmitNfseRoute } from '@/app/api/nfse/[id]/transmitir/route';
import { transmitNfse, cancelNfse } from '@/lib/fiscal/nfse-transmission';
import { POST as sendNotification } from '@/app/api/notifications/send/route';
import { POST as cancelClientInvoice } from '@/app/api/client-invoices/[id]/cancel/route';
import { createImportJob, processImportJob, getImportJob } from '@/lib/sefaz/import-queue';
import {
  INVOICE_CANCELLED_STATUS,
  NFSE_CANCELLED_STATUS,
  NFSE_ISSUED_STATUS,
  NFSE_RPS_STATUS,
  issuedInvoiceData,
  issuedNfseData,
} from '@/lib/fiscal/document-status';

const officeId = 'office-A';
const actor = { userId: 'user-A', officeId };

function req(url: string, body?: unknown, method = 'POST') {
  return new NextRequest(`https://test.invalid${url}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** Prova de autorização como um provedor real devolveria. */
const proof = {
  protocol: 'PROTOCOLO-123456',
  verificationCode: 'ABC12345',
  environment: 'HOMOLOGACAO' as const,
  authorizedAt: new Date('2026-11-14T12:00:00Z'),
};

const stubProvider = (overrides: Partial<{ transmit: () => Promise<typeof proof>; cancel: () => Promise<typeof proof> }> = {}) => ({
  name: 'stub-municipio',
  transmit: overrides.transmit ?? (async () => proof),
  cancel: overrides.cancel ?? (async () => proof),
});

const rps = {
  id: 'nfse-1', officeId, numero: '000001', status: NFSE_RPS_STATUS, codigoVerificacao: null,
  competencia: '2026-11', xmlContent: '<xml/>', deleted: false,
};
const issued = { ...rps, status: NFSE_ISSUED_STATUS, codigoVerificacao: 'ABC12345' };

beforeEach(() => {
  vi.clearAllMocks();
  h.auth.mockResolvedValue({ payload: { userId: 'user-A', officeId, role: 'OWNER' } });
  h.resolveNfseProvider.mockResolvedValue(null);
  h.db.office.findUnique.mockResolvedValue({
    id: officeId, cnpj: '12345678000190', name: 'Oficina A', email: 'a@example.invalid',
    phone: '71999999999', address: 'Rua A', city: 'Itapetinga', state: 'BA', zipCode: '45700000',
    waEnabled: false, waApiUrl: null, waApiToken: null, waInstance: null,
  });
  h.db.nfseServico.findFirst.mockResolvedValue(null);
  h.db.nfseServico.findUnique.mockResolvedValue(structuredClone(rps));
  h.db.nfseServico.create.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: 'nfse-new', ...a.data }));
  h.db.nfseServico.updateMany.mockResolvedValue({ count: 1 });
  h.db.notification.findFirst.mockResolvedValue({ id: 'created-id', status: 'PENDENTE' });
});

describe('NFS-e: criação gera RPS, não documento fiscal (FISC-01)', () => {
  const body = {
    officeId, discriminacao: 'Manutenção de veículo', valorServicos: 100, aliqIssqn: 5,
    clienteNome: 'Cliente A', competencia: '2026-11',
  };

  it('grava RPS sem código de verificação e avisa que não há transmissão', async () => {
    const res = await createNfse(req('/api/nfse', body));
    expect(res.status).toBe(201);

    const created = h.db.nfseServico.create.mock.calls[0][0].data;
    expect(created.status).toBe(NFSE_RPS_STATUS);
    expect(created.status).not.toBe('EMITIDA');
    // O código de verificação é do município: não pode nascer de Math.random.
    expect(created.codigoVerificacao).toBeNull();

    const json = await res.json();
    expect(json.transmitted).toBe(false);
    expect(json.warning).toMatch(/transmita/i);
  });

  it('recusa calcular ISS sem alíquota informada (FISC-08: nada de default de 5%)', async () => {
    const { aliqIssqn: _ignored, ...semAliquota } = body;
    const res = await createNfse(req('/api/nfse', semAliquota));
    expect(res.status).toBe(400);
    expect(h.db.nfseServico.create).not.toHaveBeenCalled();
  });

  it('aceita alíquota zero explícita sem confundir com ausência', async () => {
    const res = await createNfse(req('/api/nfse', { ...body, aliqIssqn: 0, tipoTributacao: 'ISENTO' }));
    expect(res.status).toBe(201);
    expect(h.db.nfseServico.create.mock.calls[0][0].data.aliqIssqn).toBe(0);
  });
});

describe('transmissão de NFS-e: EMITIDA só com prova', () => {
  it('sem provedor configurado responde 501 e o RPS continua RPS', async () => {
    h.db.nfseServico.findFirst.mockResolvedValue(structuredClone(rps));

    await expect(transmitNfse('nfse-1', actor)).rejects.toMatchObject({
      status: 501, code: 'PROVIDER_NOT_INTEGRATED',
    });
    expect(h.db.nfseServico.updateMany).not.toHaveBeenCalled();
  });

  it('a rota devolve 501 com o código, sem marcar nada como emitida', async () => {
    h.db.nfseServico.findFirst.mockResolvedValue(structuredClone(rps));
    const res = await transmitNfseRoute(req('/api/nfse/nfse-1/transmitir', {}), { params: Promise.resolve({ id: 'nfse-1' }) });
    expect(res.status).toBe(501);
    const json = await res.json();
    expect(json.code).toBe('PROVIDER_NOT_INTEGRATED');
    expect(h.db.nfseServico.updateMany).not.toHaveBeenCalled();
  });

  it('com provedor autorizado grava EMITIDA, o código do município e audita', async () => {
    h.db.nfseServico.findFirst.mockResolvedValueOnce(structuredClone(rps)).mockResolvedValue(structuredClone(issued));

    const result = await transmitNfse('nfse-1', actor, { provider: stubProvider() });

    expect(result.alreadyTransmitted).toBe(false);
    const write = h.db.nfseServico.updateMany.mock.calls[0][0];
    // CAS: só quem ainda vê RPS transmite.
    expect(write.where).toMatchObject({ id: 'nfse-1', officeId, status: NFSE_RPS_STATUS });
    expect(write.data).toMatchObject({ status: NFSE_ISSUED_STATUS, codigoVerificacao: 'ABC12345' });
    expect(h.auditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'NFSE_TRANSMITTED',
      entityId: 'nfse-1',
    }));
  });

  it('provedor que responde sem protocolo não consegue marcar como emitida', async () => {
    h.db.nfseServico.findFirst.mockResolvedValue(structuredClone(rps));
    const provider = stubProvider({
      transmit: async () => ({ ...proof, protocol: '   ' }),
    });

    await expect(transmitNfse('nfse-1', actor, { provider })).rejects.toMatchObject({
      status: 409, code: 'NOT_AUTHORIZED',
    });
    expect(h.db.nfseServico.updateMany).not.toHaveBeenCalled();
  });

  it('retry de transmissão é idempotente e não chama o provedor de novo', async () => {
    h.db.nfseServico.findFirst.mockResolvedValue(structuredClone(issued));
    const provider = stubProvider();
    const transmit = vi.fn(provider.transmit);

    const result = await transmitNfse('nfse-1', actor, { provider: { ...provider, transmit } });

    expect(result.alreadyTransmitted).toBe(true);
    expect(transmit).not.toHaveBeenCalled();
    expect(h.db.nfseServico.updateMany).not.toHaveBeenCalled();
  });

  it('perdedor do CAS sai com 409 sem sobrescrever a autorização alheia', async () => {
    h.db.nfseServico.findFirst.mockResolvedValue(structuredClone(rps));
    h.db.nfseServico.updateMany.mockResolvedValue({ count: 0 });

    await expect(transmitNfse('nfse-1', actor, { provider: stubProvider() })).rejects.toMatchObject({
      status: 409, code: 'CONCURRENT_TRANSMISSION',
    });
  });
});

describe('cancelamento de NFS-e', () => {
  it('RPS nunca transmitido é descartado localmente, sem exigir prova', async () => {
    h.db.nfseServico.findFirst
      .mockResolvedValueOnce(structuredClone(rps))
      .mockResolvedValue({ ...rps, status: NFSE_CANCELLED_STATUS });

    const result = await cancelNfse('nfse-1', actor, 'serviço não executado');

    expect(result.alreadyCancelled).toBe(false);
    const write = h.db.nfseServico.updateMany.mock.calls[0][0];
    expect(write.data).toMatchObject({ status: NFSE_CANCELLED_STATUS });
    expect(h.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'NFSE_RPS_DISCARDED' }));
  });

  it('NFS-e autorizada não cancela sem integração com o município', async () => {
    h.db.nfseServico.findFirst.mockResolvedValue(structuredClone(issued));

    await expect(cancelNfse('nfse-1', actor, 'serviço não executado')).rejects.toMatchObject({
      status: 501, code: 'PROVIDER_NOT_INTEGRATED',
    });
    expect(h.db.nfseServico.updateMany).not.toHaveBeenCalled();
  });

  it('motivo curto é recusado antes de tocar o banco', async () => {
    await expect(cancelNfse('nfse-1', actor, 'x')).rejects.toMatchObject({ status: 400, code: 'MISSING_REASON' });
    expect(h.db.nfseServico.findFirst).not.toHaveBeenCalled();
  });

  it('DELETE sem motivo não cancela mais "sem motivo informado"', async () => {
    const res = await deleteNfse(
      req('/api/nfse/nfse-1?officeId=office-A', undefined, 'DELETE'),
      { params: Promise.resolve({ id: 'nfse-1' }) },
    );
    expect(res.status).toBe(400);
    expect(h.db.nfseServico.updateMany).not.toHaveBeenCalled();
    expect(h.db.nfseServico.update).not.toHaveBeenCalled();
  });
});

describe('nota de venda: rascunho até a SEFAZ autorizar (FISC-02)', () => {
  it('EMITIDA exige prova com protocolo e chave de 44 dígitos', () => {
    const data = issuedInvoiceData(proof, '1'.repeat(44));
    expect(data).toMatchObject({ status: 'EMITIDA', protocoloAutorizacao: 'PROTOCOLO-123456' });

    expect(() => issuedInvoiceData(null, '1'.repeat(44))).toThrowError(/não foi autorizado/);
    expect(() => issuedInvoiceData(proof, '123')).toThrowError(/chave de acesso de 44 dígitos/);
  });

  it('rascunho é descartado localmente; autorizada exige prova de cancelamento', async () => {
    h.db.clientInvoice.findUnique.mockResolvedValue({
      id: 'ci-1', officeId, number: '1', chave: null, status: 'RASCUNHO', deleted: false,
    });
    const draft = await cancelClientInvoice(
      req('/api/client-invoices/ci-1/cancel', { officeId, motivoCancelamento: 'venda estornada' }),
      { params: Promise.resolve({ id: 'ci-1' }) },
    );
    expect(draft.status).toBe(200);
    expect(h.db.clientInvoice.update.mock.calls[0][0].data).toMatchObject({ status: INVOICE_CANCELLED_STATUS });
    // A rota audita via auditLog('@/lib/auth'): o descarte de rascunho fica explícito.
    expect(h.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'NFE_DRAFT_DISCARDED' }));

    vi.clearAllMocks();
    h.auth.mockResolvedValue({ payload: { userId: 'user-A', officeId, role: 'OWNER' } });
    h.db.clientInvoice.findUnique.mockResolvedValue({
      id: 'ci-2', officeId, number: '2', chave: '1'.repeat(44),
      protocoloAutorizacao: 'PROTO-1', status: 'EMITIDA', deleted: false,
    });
    const authorized = await cancelClientInvoice(
      req('/api/client-invoices/ci-2/cancel', { officeId, motivoCancelamento: 'venda estornada' }),
      { params: Promise.resolve({ id: 'ci-2' }) },
    );
    // Nota autorizada pela SEFAZ não pode ser "cancelada" só no banco.
    expect(authorized.status).toBe(409);
    expect(h.db.clientInvoice.update).not.toHaveBeenCalled();
  });
});

describe('notificações: simulado não é enviado (NOT-01)', () => {
  const base = { officeId, type: 'EMAIL', title: 'Orçamento', message: 'Seu orçamento', recipient: 'c@example.invalid' };

  it('e-mail sem provedor fica PENDENTE e a resposta não alega entrega', async () => {
    const res = await sendNotification(req('/api/notifications/send', base));
    expect(res.status).toBe(201);

    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.delivered).toBe(false);
    expect(json.notIntegrated).toBe(true);
    expect(json.data.sendResult.method).toBe('EMAIL_NAO_INTEGRADO');

    expect(h.db.notification.update.mock.calls[0][0].data.status).toBe('PENDENTE');
    expect(h.db.notification.update.mock.calls[0][0].data.status).not.toBe('ENVIADA');
    expect(h.db.notification.update.mock.calls[0][0].data.sentAt).toBeUndefined();
  });

  it('WhatsApp não configurado também não é gravado como enviado', async () => {
    h.db.office.findUnique.mockResolvedValue({ id: officeId, waEnabled: false });
    const res = await sendNotification(req('/api/notifications/send', { ...base, type: 'WHATSAPP', recipient: '71999999999' }));
    const json = await res.json();
    expect(json.delivered).toBe(false);
    expect(h.db.notification.update.mock.calls[0][0].data.status).toBe('PENDENTE');
  });

  it('WhatsApp com API respondendo ok continua sendo ENVIADA', async () => {
    h.db.office.findUnique.mockResolvedValue({
      id: officeId, waEnabled: true, waApiUrl: 'https://wa.example.invalid',
      waApiToken: 'enc-token', waInstance: 'inst1',
    });
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const res = await sendNotification(req('/api/notifications/send', { ...base, type: 'WHATSAPP', recipient: '71999999999' }));
    const json = await res.json();
    expect(json.delivered).toBe(true);
    expect(h.db.notification.update.mock.calls[0][0].data.status).toBe('ENVIADA');
    vi.unstubAllGlobals();
  });

  it('notificação de sistema é entrega real (não depende de provedor)', async () => {
    const res = await sendNotification(req('/api/notifications/send', { ...base, type: 'SYSTEM', recipient: undefined }));
    const json = await res.json();
    expect(json.delivered).toBe(true);
    expect(h.db.notification.update.mock.calls[0][0].data.status).toBe('ENVIADA');
  });
});

describe('fila de importação: COMPLETED só com nota gravada (FISC-04)', () => {
  it('falha de negócio vira FAILED com o código real, nunca COMPLETED', async () => {
    h.importNfeByChave.mockResolvedValue({
      ok: false, status: 404, code: 'CERTIFICADO_AUSENTE',
      error: 'Nenhum certificado digital ativo encontrado para este escritório',
    });

    const job = createImportJob('0'.repeat(44), officeId, 'user-A');
    await processImportJob(job.id);

    const after = getImportJob(job.id)!;
    expect(after.status).toBe('FAILED');
    expect(after.status).not.toBe('COMPLETED');
    expect(after.failureCode).toBe('CERTIFICADO_AUSENTE');
    expect(after.error).toMatch(/certificado/i);
    expect(after.progress).toBe(0);
  });

  it('sucesso exige nota persistida e carrega o invoiceId', async () => {
    h.importNfeByChave.mockResolvedValue({
      ok: true, invoiceId: 'inv-1', chave: '1'.repeat(44), numero: '123',
      fornecedor: 'Fornecedor', valorTotal: 500, sefazConsultaId: 'sc-1',
    });

    const job = createImportJob('1'.repeat(44), officeId, 'user-A');
    await processImportJob(job.id);

    const after = getImportJob(job.id)!;
    expect(after.status).toBe('COMPLETED');
    expect(after.progress).toBe(100);
    expect(after.result).toMatchObject({ invoiceId: 'inv-1', chave: '1'.repeat(44) });
    expect(h.importNfeByChave).toHaveBeenCalledWith({
      chave: '1'.repeat(44), officeId, userId: 'user-A',
    });
  });

  it('exceção inesperada não é engolida como sucesso', async () => {
    h.importNfeByChave.mockRejectedValue(new Error('SEFAZ indisponível'));

    const job = createImportJob('2'.repeat(44), officeId, 'user-A');
    await processImportJob(job.id);

    const after = getImportJob(job.id)!;
    expect(after.status).toBe('FAILED');
    expect(after.failureCode).toBe('INTERNAL_ERROR');
    expect(after.error).toBe('SEFAZ indisponível');
  });
});

describe('prova de autorização é pré-requisito estrutural', () => {
  it('issuedNfseData recusa prova ausente, vazia ou sem protocolo', () => {
    expect(() => issuedNfseData(null)).toThrowError(/não pode ser marcado como emitido/);
    expect(() => issuedNfseData(undefined)).toThrowError(/não pode ser marcado como emitido/);
    expect(() => issuedNfseData({ ...proof, protocol: '' })).toThrowError(/não pode ser marcado como emitido/);
  });

  it('código de verificação ausente na resposta vira null, não valor inventado', () => {
    const data = issuedNfseData({ ...proof, verificationCode: undefined });
    expect(data).toMatchObject({ status: NFSE_ISSUED_STATUS, codigoVerificacao: null });
  });
});
