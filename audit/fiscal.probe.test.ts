/** Sonda de caracterização: o gerador produz linhas, mas o layout não é validado pelo PVA. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => {
  const list = vi.fn(async (): Promise<any[]> => []);
  const zero = vi.fn(async () => 0);
  return { db: {
    office: { findUnique: vi.fn() }, supplier: { findMany: list, count: zero }, client: { findMany: list, count: zero },
    part: { findMany: vi.fn(async (): Promise<any[]> => []), count: zero }, invoice: { count: zero, findMany: list },
    clientInvoice: { count: zero, findMany: list }, nfseServico: { count: zero, findMany: list },
  } };
});
vi.mock('@/lib/db', () => ({ db: h.db }));
import { generateSpedFiscal } from '@/lib/sped/sped-generator';

beforeEach(() => {
  vi.clearAllMocks();
  h.db.office.findUnique.mockResolvedValue({ id: 'office-A', cnpj: '12345678000190', name: 'Oficina A', state: 'BA', email: 'a@example.invalid', phone: '71999999999', zipCode: '40000000', address: 'Rua A' });
  h.db.part.findMany.mockResolvedValue([{ id: 'part-A', sku: 'P1', description: 'Peça', unit: 'UN', quantity: 2, costPrice: 10, ncm: '12345678', cfop: '5102', cst: '00', csosn: '', barcode: '', exIpi: '' }]);
});

describe('Sonda SPED (dados simulados; não substitui validação fiscal)', () => {
  it('H010 desloca unidade/quantidade/valor e 0200 usa campos incompatíveis', async () => {
    const result = await generateSpedFiscal({ officeId: 'office-A', competencia: '202611' });
    expect(result.success).toBe(true);
    const h010 = result.conteudo.split('\n').find(l => l.startsWith('|H010|'))!;
    const fields = h010.split('|');
    expect(fields[3]).toBe(''); // UNID vazio
    expect(fields[4]).toBe('UN'); // QTD recebe a unidade
    expect(fields[5]).toBe('2,000'); // VL_UNIT recebe a quantidade
    const r0200 = result.conteudo.split('\n').find(l => l.startsWith('|0200|'))!;
    expect(r0200.split('|')[7]).toBe('5102'); // COD_GEN recebe CFOP
    expect(r0200.split('|')[9]).toBe('00'); // ALIQ_ICMS recebe CST
    expect(r0200.split('|')[12]).toBe('2,000'); // campo inexistente QTD_INV
    expect(result.conteudo).toContain('|0100|CONTADOR|');
  });
});
