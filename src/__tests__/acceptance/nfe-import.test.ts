/**
 * Passo 5 — o núcleo real da importação de NF-e (FISC-04).
 *
 * `importNfeByChave` é chamado pela rota síncrona E pelo job assíncrono, então é
 * aqui que "concluído" precisa significar "nota gravada". Estes testes cobrem o
 * núcleo diretamente: sem certificado, com certificado vencido, NF-e não
 * autorizada, chave já importada e o caminho de sucesso.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(async () => []),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: `gen-${Math.random().toString(36).slice(2, 8)}`, ...a.data })),
    update: vi.fn(async (a: { where: Record<string, unknown>; data: Record<string, unknown> }) => ({ ...a.where, ...a.data })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  });
  const names = ['invoice', 'certificadoDigital', 'sefazConsulta', 'supplier', 'reception', 'auditLog'];
  const db = Object.fromEntries(names.map((n) => [n, model()])) as Record<string, ReturnType<typeof model>>;
  return {
    db,
    createAuditLog: vi.fn(async () => undefined),
    consultaProtocolo: vi.fn(),
    downloadNfe: vi.fn(),
    getUfFromChave: vi.fn(() => 'BA'),
    mapSefazErrorToFriendly: vi.fn(() => 'Erro SEFAZ'),
    decryptFileContent: vi.fn(() => 'pfx-base64'),
    decryptPassword: vi.fn(() => 'senha'),
    parseNFeXml: vi.fn(),
    validateXmlStructure: vi.fn(() => ({ valid: true, errors: [] as string[] })),
  };
});

vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/audit', () => ({ createAuditLog: h.createAuditLog }));
vi.mock('@/lib/sefaz', () => ({
  consultaProtocolo: h.consultaProtocolo,
  downloadNfe: h.downloadNfe,
  getUfFromChave: h.getUfFromChave,
  mapSefazErrorToFriendly: h.mapSefazErrorToFriendly,
  decryptFileContent: h.decryptFileContent,
  decryptPassword: h.decryptPassword,
}));
vi.mock('@/lib/nfe/xml-parser', () => ({
  parseNFeXml: h.parseNFeXml,
  validateXmlStructure: h.validateXmlStructure,
}));

import { importNfeByChave } from '@/lib/sefaz/nfe-import';

const officeId = 'office-A';
const userId = 'user-A';
const chave = '29261112345678000190550010000001231000001237';

const certificadoValido = {
  id: 'cert-1', officeId, ativo: true, deleted: false, ambiente: 'HOMOLOGACAO', uf: 'BA',
  cnpjCpf: '12345678000190', arquivoContent: 'enc-pfx', senhaCriptografada: 'enc-senha',
  validade: new Date(Date.now() + 86_400_000),
};

const parsedNFe = {
  chave, numero: '123', serie: '1', dataEmissao: '2026-11-01T12:00:00Z',
  supplierCnpj: '98765432000110', supplierRazaoSocial: 'Fornecedor LTDA',
  emitente: {
    nomeFantasia: 'Fornecedor', ie: '12345678',
    endereco: { logradouro: 'Rua B', numero: '20', municipio: 'Salvador', uf: 'BA', cep: '40000000', fone: '7133333333' },
  },
  totals: { vFrete: 0, vSeg: 0, vDesc: 0, vBC: 100, vICMS: 18, vIPI: 0, vPIS: 0.65, vCOFINS: 3, vNF: 100 },
  items: [{
    cProd: 'P1', xProd: 'Peça', ncm: '12345678', cfop: '5102', cst: '00', csosn: null,
    qCom: 2, uCom: 'UN', vUnCom: 50, vProd: 100, vBC_Icms: 100, vICMS: 18, vIPI: 0, vPIS: 0.65, vCOFINS: 3,
  }],
  infCpl: null, naturezaOperacao: 'VENDA', transporte: null, formaPagamento: null, duplicatas: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  h.db.invoice.findFirst.mockResolvedValue(null);
  h.db.certificadoDigital.findFirst.mockResolvedValue(structuredClone(certificadoValido));
  h.db.sefazConsulta.create.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: 'sc-1', ...a.data }));
  h.db.supplier.findFirst.mockResolvedValue(null);
  h.db.invoice.create.mockImplementation(async (a: { data: Record<string, unknown> }) => ({ id: 'inv-1', ...a.data }));
  h.consultaProtocolo.mockResolvedValue({
    success: true, tentativas: 1, tempoResposta: 120,
    data: { nfeStatus: 'AUTORIZADA', cStat: '100', xMotivo: 'Autorizado o uso da NF-e', protocolo: '123456', fornecedorCnpj: '98765432000110' },
  });
  h.downloadNfe.mockResolvedValue({ success: true, data: { xmlContent: '<NFe>…</NFe>' } });
  h.parseNFeXml.mockReturnValue(parsedNFe);
});

describe('importação por chave: pré-condições antes de falar com a SEFAZ', () => {
  it('chave já importada não consulta de novo', async () => {
    h.db.invoice.findFirst.mockResolvedValue({ id: 'inv-existente', chave });

    const result = await importNfeByChave({ chave, officeId, userId });

    expect(result).toMatchObject({ ok: false, code: 'ALREADY_IMPORTED', status: 409 });
    expect(h.consultaProtocolo).not.toHaveBeenCalled();
    expect(h.db.invoice.create).not.toHaveBeenCalled();
  });

  it('sem certificado ativo falha com o motivo verdadeiro', async () => {
    h.db.certificadoDigital.findFirst.mockResolvedValue(null);

    const result = await importNfeByChave({ chave, officeId, userId });

    expect(result).toMatchObject({ ok: false, code: 'CERTIFICADO_AUSENTE', status: 404 });
    expect(h.consultaProtocolo).not.toHaveBeenCalled();
  });

  it('certificado vencido não é usado para autorizar nada', async () => {
    h.db.certificadoDigital.findFirst.mockResolvedValue({
      ...certificadoValido, validade: new Date('2025-01-01T00:00:00Z'),
    });

    const result = await importNfeByChave({ chave, officeId, userId });

    expect(result).toMatchObject({ ok: false, code: 'CERTIFICADO_VENCIDO', status: 409 });
    expect(result.ok === false && result.error).toMatch(/vencido/i);
    // Falhar antes do handshake devolve o motivo real, não um erro de TLS obscuro.
    expect(h.consultaProtocolo).not.toHaveBeenCalled();
    expect(h.db.invoice.create).not.toHaveBeenCalled();
  });

  it('certificado sem data de validade não é bloqueado pelo check de expiração', async () => {
    h.db.certificadoDigital.findFirst.mockResolvedValue({ ...certificadoValido, validade: null });

    const result = await importNfeByChave({ chave, officeId, userId });

    expect(result.ok).toBe(true);
  });
});

describe('importação por chave: resposta da SEFAZ decide o resultado', () => {
  it('NF-e cancelada não é importada, mesmo tendo protocolo de autorização anterior', async () => {
    // Cenário real: a nota foi autorizada (existe nProt) e depois cancelada. O
    // protocolo não a salva — o status bloqueado é o que decide.
    h.consultaProtocolo.mockResolvedValue({
      success: true, tentativas: 1, tempoResposta: 90,
      data: { nfeStatus: 'CANCELADA', cStat: '101', xMotivo: 'Cancelamento homologado', protocolo: '123456' },
    });

    const result = await importNfeByChave({ chave, officeId, userId });

    expect(result).toMatchObject({ ok: false, code: 'NFE_NAO_AUTORIZADA', status: 422 });
    expect(result.ok === false && result.error).toMatch(/cancelada/i);
    // A evidência durável do que a SEFAZ respondeu existe mesmo no fracasso.
    expect(h.db.sefazConsulta.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ chave, status: 'CANCELADA', officeId, usuarioId: userId }),
    }));
    expect(h.downloadNfe).not.toHaveBeenCalled();
    expect(h.db.invoice.create).not.toHaveBeenCalled();
  });

  it.each(['CANCELADA', 'DENEGADA', 'INUTILIZADA'])(
    'status %s é bloqueado mesmo com protocolo e XML disponível',
    async (status) => {
      h.consultaProtocolo.mockResolvedValue({
        success: true, tentativas: 1, tempoResposta: 90,
        data: { nfeStatus: status, cStat: '101', xMotivo: status, protocolo: '123456' },
      });

      const result = await importNfeByChave({ chave, officeId, userId });

      expect(result).toMatchObject({ ok: false, code: 'NFE_NAO_AUTORIZADA', status: 422 });
      expect(h.downloadNfe).not.toHaveBeenCalled();
      expect(h.db.invoice.create).not.toHaveBeenCalled();
    }
  );

  it('consulta que falha não vira importação', async () => {
    h.consultaProtocolo.mockResolvedValue({
      success: false, tentativas: 3, error: 'timeout', friendlyError: 'SEFAZ indisponível', data: null,
    });

    const result = await importNfeByChave({ chave, officeId, userId });

    expect(result).toMatchObject({ ok: false, code: 'NFE_NAO_AUTORIZADA' });
    expect(h.db.invoice.create).not.toHaveBeenCalled();
  });

  it('status autorizado sem protocolo de autorização não vira importação', async () => {
    // O protocolo (nProt) é a prova de que a SEFAZ autorizou o documento. Sem ele
    // não há como afirmar que a nota existe — mesmo que o status diga "autorizada".
    h.consultaProtocolo.mockResolvedValue({
      success: true, tentativas: 1, tempoResposta: 100,
      data: { nfeStatus: 'AUTORIZADA', cStat: '100', xMotivo: 'Autorizado o uso da NF-e', protocolo: null },
    });

    const result = await importNfeByChave({ chave, officeId, userId });

    expect(result).toMatchObject({ ok: false, code: 'NFE_NAO_AUTORIZADA', status: 422 });
    expect(result.ok === false && result.error).toMatch(/protocolo/i);
    expect(h.downloadNfe).not.toHaveBeenCalled();
    expect(h.db.invoice.create).not.toHaveBeenCalled();
  });

  it('XML que não baixa não vira importação', async () => {
    h.downloadNfe.mockResolvedValue({ success: false, data: null });

    const result = await importNfeByChave({ chave, officeId, userId });

    expect(result).toMatchObject({ ok: false, code: 'XML_INDISPONIVEL', status: 422 });
    expect(h.db.invoice.create).not.toHaveBeenCalled();
  });

  it('XML inválido ou ilegível não vira importação', async () => {
    h.validateXmlStructure.mockReturnValue({ valid: false, errors: ['faltando infNFe'] });
    expect(await importNfeByChave({ chave, officeId, userId }))
      .toMatchObject({ ok: false, code: 'XML_INVALIDO', status: 400 });

    h.validateXmlStructure.mockReturnValue({ valid: true, errors: [] });
    h.parseNFeXml.mockImplementation(() => { throw new Error('XML truncado'); });
    expect(await importNfeByChave({ chave, officeId, userId }))
      .toMatchObject({ ok: false, code: 'XML_PARSE_ERROR', status: 400 });

    expect(h.db.invoice.create).not.toHaveBeenCalled();
  });
});

describe('importação por chave: sucesso grava tudo', () => {
  it('devolve invoiceId, grava itens, recepção, vínculo da consulta e auditoria', async () => {
    const result = await importNfeByChave({ chave, officeId, userId });

    expect(result).toMatchObject({ ok: true, invoiceId: 'inv-1', chave, numero: '123' });

    const invoiceData = h.db.invoice.create.mock.calls[0][0].data;
    expect(invoiceData).toMatchObject({ chave, status: 'IMPORTADA', totalNf: 100, officeId });
    expect(invoiceData.items.create).toHaveLength(1);
    expect(invoiceData.items.create[0]).toMatchObject({ descricao: 'Peça', quantidade: 2, cfop: '5102' });

    expect(h.db.reception.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PENDENTE', invoiceId: 'inv-1', officeId }),
    }));
    expect(h.db.sefazConsulta.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sc-1' }, data: { invoiceId: 'inv-1' },
    }));
    expect(h.createAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      action: 'SEFAZ_IMPORTAR', entity: 'Invoice', entityId: 'inv-1', userId, officeId,
    }));
  });

  it('fornecedor existente é reaproveitado e enriquecido, não duplicado', async () => {
    h.db.supplier.findFirst.mockResolvedValue({ id: 'sup-1', cnpj: '98765432000110', razaoSocial: 'Antigo' });

    const result = await importNfeByChave({ chave, officeId, userId });

    expect(result).toMatchObject({ ok: true, fornecedor: 'Antigo' });
    expect(h.db.supplier.create).not.toHaveBeenCalled();
    expect(h.db.supplier.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'sup-1' },
      data: expect.objectContaining({ razaoSocial: 'Fornecedor LTDA', city: 'Salvador' }),
    }));
  });
});
