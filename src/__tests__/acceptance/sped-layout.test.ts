/**
 * Passo 5 — layout do SPED Fiscal (FISC-03, sonda 17).
 *
 * Estes testes conferem o arquivo campo a campo contra o Guia Prático da
 * EFD-ICMS/IPI. O que eles NÃO fazem — e nada neste repositório pode fazer — é
 * substituir a validação no PVA com um contador: veja
 * audit/IMPLEMENTACAO-FISCAL.md.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const list = vi.fn(async (): Promise<unknown[]> => []);
  const zero = vi.fn(async () => 0);
  return {
    db: {
      office: { findUnique: vi.fn() },
      supplier: { findMany: list, count: zero },
      client: { findMany: list, count: zero },
      part: { findMany: vi.fn(async (): Promise<unknown[]> => []), count: zero },
      taxRule: { findMany: vi.fn(async (): Promise<unknown[]> => []) },
      invoice: { count: zero, findMany: list },
      clientInvoice: { count: zero, findMany: list },
      nfseServico: { count: zero, findMany: list },
    },
  };
});
vi.mock('@/lib/db', () => ({ db: h.db }));

import { generateSpedFiscal, type SpedContabilista } from '@/lib/sped/sped-generator';

const contabilista: SpedContabilista = {
  nome: 'Maria Contadora',
  cpf: '123.456.789-09',
  crc: 'BA-012345/O-1',
  cnpj: '98.765.432/0001-10',
  cep: '45700-000',
  endereco: 'Rua das Contas',
  num: '100',
  compl: 'Sala 2',
  bairro: 'Centro',
  fone: '(77) 3261-0000',
  fax: '',
  email: 'maria@contabilidade.example.invalid',
};

/** `|REG|f1|f2|` -> ['', 'REG', 'f1', 'f2', ''] */
function fieldsOf(conteudo: string, registro: string): string[] {
  const line = conteudo.split('\n').find((l) => l.startsWith(`|${registro}|`));
  expect(line, `registro ${registro} ausente`).toBeTruthy();
  return line!.split('|');
}

beforeEach(() => {
  vi.clearAllMocks();
  h.db.office.findUnique.mockResolvedValue({
    id: 'office-A', cnpj: '12345678000190', name: 'Oficina A', state: 'BA',
    email: 'a@example.invalid', phone: '71999999999', zipCode: '45700000', address: 'Rua A',
  });
  h.db.part.findMany.mockResolvedValue([
    { id: 'part-A', sku: 'P1', description: 'Peça de teste', unit: 'UN', quantity: 2, costPrice: 10, ncm: '12345678', cfop: '5102', cst: '00', csosn: '101' },
  ]);
  h.db.taxRule.findMany.mockResolvedValue([
    { id: 'tr-1', ncm: '12345678', cfop: '5102', state: 'BA', aliqIcms: 18, active: true, officeId: 'office-A' },
  ]);
});

describe('registro 0100 — dados do contabilista', () => {
  it('recusa gerar o arquivo com contabilista fictício', async () => {
    const result = await generateSpedFiscal({ officeId: 'office-A', competencia: '202611' });

    expect(result.success).toBe(false);
    expect(result.conteudo).toBe('');
    expect(result.errors?.join(' ')).toMatch(/0100/);
  });

  it('valida CPF de 11 dígitos, CRC e e-mail em vez de aceitar qualquer coisa', async () => {
    const result = await generateSpedFiscal({
      officeId: 'office-A',
      competencia: '202611',
      contabilista: { ...contabilista, cpf: '123', crc: '  ', email: 'nao-é-email' },
    });

    expect(result.success).toBe(false);
    const errors = result.errors?.join(' ') ?? '';
    expect(errors).toMatch(/CPF/);
    expect(errors).toMatch(/CRC/);
    expect(errors).toMatch(/e-mail/);
  });

  it('emite os 13 campos do guia com os dados reais', async () => {
    const result = await generateSpedFiscal({ officeId: 'office-A', competencia: '202611', contabilista });
    expect(result.success).toBe(true);

    const f = fieldsOf(result.conteudo, '0100');
    expect(f).toHaveLength(15); // '' + 13 campos + ''
    expect(f[1]).toBe('0100');
    expect(f[2]).toBe('Maria Contadora');       // NOME
    expect(f[3]).toBe('12345678909');           // CPF, só dígitos
    expect(f[4]).toBe('BA-012345/O-1');         // CRC
    expect(f[5]).toBe('98765432000110');        // CNPJ
    expect(f[6]).toBe('45700000');              // CEP
    expect(f[7]).toBe('Rua das Contas');        // ENDERECO
    expect(f[8]).toBe('100');                   // NUM
    expect(f[9]).toBe('Sala 2');                // COMPL
    expect(f[10]).toBe('Centro');               // BAIRRO
    expect(f[11]).toBe('7732610000');           // FONE
    expect(f[12]).toBe('');                     // FAX
    expect(f[13]).toBe('maria@contabilidade.example.invalid'); // EMAIL

    expect(result.conteudo).not.toContain('|0100|CONTADOR|');
    // CRC fictício da versão anterior ('9999') não pode voltar — na linha do 0100.
    expect(f[4]).not.toBe('9999');
    expect(f[2]).not.toBe('CONTADOR');
  });
});

describe('registro 0200 — identificação do item', () => {
  it('usa os 13 campos vigentes, sem CFOP, sem CST e sem campos de estoque', async () => {
    const result = await generateSpedFiscal({ officeId: 'office-A', competencia: '202611', contabilista });
    expect(result.success).toBe(true);

    const f = fieldsOf(result.conteudo, '0200');
    expect(f).toHaveLength(15); // '' + 13 campos + ''
    expect(f[1]).toBe('0200');
    expect(f[2]).toBe('P1');                 // COD_ITEM
    expect(f[3]).toBe('Peça de teste');      // DESCR_ITEM
    expect(f[4]).toBe('');                   // COD_BARRA (Part não tem a coluna)
    expect(f[5]).toBe('');                   // COD_ANT_ITEM
    expect(f[6]).toBe('UN');                 // UNID_INV
    expect(f[7]).toBe('00');                 // TIPO_ITEM: mercadoria para revenda
    expect(f[8]).toBe('12345678');           // COD_NCM
    expect(f[9]).toBe('');                   // COD_EX_IPI (Part não tem a coluna)
    expect(f[10]).toBe('12');                // COD_GEN = gênero (2 primeiros dígitos do NCM)
    expect(f[11]).toBe('');                  // COD_LST (serviços)
    expect(f[12]).toBe('18,00');             // ALIQ_ICMS da regra tributária
    expect(f[13]).toBe('');                  // CEST

    // O que a versão anterior colocava aqui não pertence ao cadastro do item.
    expect(f).not.toContain('5102');         // CFOP é de documento fiscal (C170/C190)
    expect(f).not.toContain('101');          // CSOSN não é CEST
    // CST não tem posição no 0200. '00' continua presente, mas como TIPO_ITEM
    // (f[7]) — por isso a verificação de CST/CSOSN é por posição, acima.
    expect(f[13]).toBe('');
    expect(f).not.toContain('2,000');        // quantidade de estoque é do bloco H
    expect(f).not.toContain('10,00');        // custo é do bloco H
  });

  it('COD_GEN não é CFOP: sai do NCM, e sem NCM fica vazio', async () => {
    h.db.part.findMany.mockResolvedValue([
      { id: 'p2', sku: 'P2', description: 'Sem NCM', unit: 'UN', quantity: 1, costPrice: 5, ncm: null, cfop: '5102', cst: '00' },
    ]);

    const result = await generateSpedFiscal({ officeId: 'office-A', competencia: '202611', contabilista });
    const f = fieldsOf(result.conteudo, '0200');
    expect(f[8]).toBe('');  // COD_NCM
    expect(f[10]).toBe(''); // COD_GEN
    expect(f).not.toContain('5102');
  });

  it('ALIQ_ICMS sem regra configurada fica vazio, não inventado', async () => {
    h.db.taxRule.findMany.mockResolvedValue([]);

    const result = await generateSpedFiscal({ officeId: 'office-A', competencia: '202611', contabilista });
    const f = fieldsOf(result.conteudo, '0200');
    expect(f[12]).toBe('');
  });
});

describe('registro H010 — inventário físico', () => {
  it('cada campo recebe o seu valor, com IND_PROP obrigatório preenchido', async () => {
    const result = await generateSpedFiscal({ officeId: 'office-A', competencia: '202611', contabilista });
    expect(result.success).toBe(true);

    const f = fieldsOf(result.conteudo, 'H010');
    expect(f).toHaveLength(13); // '' + 11 campos + ''
    expect(f[1]).toBe('H010');
    expect(f[2]).toBe('P1');          // COD_ITEM
    expect(f[3]).toBe('UN');          // UNID
    expect(f[4]).toBe('2,000');       // QTD
    expect(f[5]).toBe('10,000000');   // VL_UNIT (6 decimais)
    expect(f[6]).toBe('20,00');       // VL_ITEM = 2 x 10
    expect(f[7]).toBe('0');           // IND_PROP: próprio e em seu poder
    expect(f[8]).toBe('');            // COD_PART (só com IND_PROP 1 ou 2)
    expect(f[9]).toBe('');            // TXT_COMPL
    expect(f[10]).toBe('');           // COD_CTA
    expect(f[11]).toBe('20,00');      // VL_ITEM_IR
  });

  it('a unidade do H010 existe no 0190 e coincide com o UNID_INV do 0200', async () => {
    const result = await generateSpedFiscal({ officeId: 'office-A', competencia: '202611', contabilista });

    const unidades = result.conteudo
      .split('\n')
      .filter((l) => l.startsWith('|0190|'))
      .map((l) => l.split('|')[2]);
    const unidH010 = fieldsOf(result.conteudo, 'H010')[3];
    const unidInv0200 = fieldsOf(result.conteudo, '0200')[6];

    // O guia exige coerência entre os três registros.
    expect(unidades).toContain(unidH010);
    expect(unidH010).toBe(unidInv0200);
  });
});
