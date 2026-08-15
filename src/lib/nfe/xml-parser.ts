/**
 * NF-e XML Parser
 * Extrai dados de XML de Nota Fiscal Eletrônica brasileira
 * Usa regex/string parsing para evitar dependências pesadas
 */

export interface NFeItem {
  cProd: string;
  xProd: string;
  ncm: string;
  cfop: string;
  qCom: number;
  uCom: string;
  vUnCom: number;
  vProd: number;
  vBC_Icms: number;
  vICMS: number;
  vIPI: number;
  vPIS: number;
  vCOFINS: number;
  cst?: string;
  csosn?: string;
}

export interface NFeTotals {
  vBC: number;
  vICMS: number;
  vIPI: number;
  vPIS: number;
  vCOFINS: number;
  vNF: number;
  vST: number;
  vFCP: number;
  vFrete: number;
  vSeg: number;
  vDesc: number;
  vOutro: number;
}

export interface NFeDuplicata {
  nDup: string;       // Número da duplicata
  dVenc: string;      // Data de vencimento (YYYY-MM-DD)
  vDup: number;       // Valor da duplicata
}

export interface NFeTransporte {
  modFrete: string;   // Modalidade do frete (0=Por conta do emitente, 1=Por conta do destinatário, 2=Terceiros, 9=Sem frete)
  transportadoraCnpj: string | null;
  transportadoraNome: string | null;
  transportadoraIe: string | null;
  veiculoPlaca: string | null;
  veiculoUf: string | null;
  volumes: Array<{
    qVol: number | null;
    esp: string | null;
    marca: string | null;
    nVol: string | null;
    pesoL: number | null;
    pesoB: number | null;
  }>;
}

export interface NFeEmitente {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  ie: string | null;       // Inscrição Estadual
  im: string | null;       // Inscrição Municipal
  cnae: string | null;
  crt: string | null;      // Código de Regime Tributário (1=Simples, 2=Simples excesso, 3=Regime Normal)
  endereco: {
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    codMunicipio: string | null;
    municipio: string | null;
    uf: string | null;
    cep: string | null;
    fone: string | null;
  };
}

export interface NFeDestinatario {
  cnpj: string | null;
  cpf: string | null;
  razaoSocial: string | null;
  ie: string | null;
  endereco: {
    logradouro: string | null;
    numero: string | null;
    bairro: string | null;
    codMunicipio: string | null;
    municipio: string | null;
    uf: string | null;
    cep: string | null;
  };
}

export interface ParsedNFe {
  chave: string;
  numero: string;
  serie: string;
  dataEmissao: string;
  naturezaOperacao: string;    // Natureza da operação (natOp)
  supplierCnpj: string;
  supplierRazaoSocial: string;
  emitente: NFeEmitente;       // Dados completos do emitente
  destCnpj?: string;
  destinatario: NFeDestinatario; // Dados completos do destinatário
  items: NFeItem[];
  totals: NFeTotals;
  vFrete: number;
  infCpl?: string;
  infAdFisco?: string;          // Informações adicionais de interesse do fisco
  duplicatas: NFeDuplicata[];   // Parcelas/duplicatas
  transporte: NFeTransporte | null; // Dados de transporte
  formaPagamento: string | null; // Forma de pagamento (0=Vista, 1=Prazo, 2=Outros)
}

/**
 * Extract a value from XML using regex
 * Handles namespaces by stripping them from tag names
 */
function extractValue(xml: string, tagPath: string[]): string | null {
  // Try each path variant
  for (const path of tagPath) {
    // Strip namespace prefixes for matching
    const cleanTag = path.replace(/[\w]+:/g, '');
    const patterns = [
      // AUD-04 FIX: Use non-capturing group (?:ns:)? so the tag name is not consumed as a namespace prefix.
      // Old pattern <[\w]*:?tagName> failed because [\w]* greedily consumed the tag name itself.
      new RegExp(`<(?:[\\w]+:)?${escapeRegex(cleanTag)}[^>]*>([^<]+)</(?:[\\w]+:)?${escapeRegex(cleanTag)}>`, 'i'),
      // Fallback: simple tag without namespace
      new RegExp(`<${escapeRegex(cleanTag)}[^>]*>([^<]+)</${escapeRegex(cleanTag)}>`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = xml.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }
  }
  return null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract all values from repeating XML elements
 */
function extractAllValues(xml: string, parentTag: string, childTag: string): string[] {
  const results: string[] = [];
  const cleanParent = parentTag.replace(/[\w]+:/g, '');
  const cleanChild = childTag.replace(/[\w]+:/g, '');

  // Find all parent blocks — AUD-04 FIX: use non-capturing group for namespace prefix
  const parentPattern = new RegExp(
    `<(?:[\\w]+:)?${escapeRegex(cleanParent)}[^>]*>([\\s\\S]*?)</(?:[\\w]+:)?${escapeRegex(cleanParent)}>`,
    'gi'
  );

  let parentMatch;
  while ((parentMatch = parentPattern.exec(xml)) !== null) {
    const block = parentMatch[1];
    const childPattern = new RegExp(
      `<(?:[\\w]+:)?${escapeRegex(cleanChild)}[^>]*>([^<]+)</(?:[\\w]+:)?${escapeRegex(cleanChild)}>`,
      'i'
    );
    const childMatch = block.match(childPattern);
    if (childMatch) {
      results.push(childMatch[1].trim());
    }
  }
  return results;
}

/**
 * Extract a section/block from XML
 */
function extractBlock(xml: string, tag: string): string | null {
  // AUD-04 FIX: Support slash-separated paths (e.g. 'total/ICMSTot') by chaining block extractions
  if (tag.includes('/')) {
    const parts = tag.split('/');
    let current: string | null = xml;
    for (const part of parts) {
      if (!current) return null;
      current = extractBlock(current, part);
    }
    return current;
  }
  const cleanTag = tag.replace(/[\w]+:/g, '');
  // AUD-04 FIX: Use non-capturing group (?:ns:)? to avoid consuming the tag name as a namespace prefix
  const pattern = new RegExp(
    `<(?:[\\w]+:)?${escapeRegex(cleanTag)}[^>]*>([\\s\\S]*?)</(?:[\\w]+:)?${escapeRegex(cleanTag)}>`,
    'i'
  );
  const match = xml.match(pattern);
  return match ? match[1] : null;
}

/**
 * Extract all blocks of a repeating element
 */
function extractAllBlocks(xml: string, tag: string): string[] {
  const results: string[] = [];
  const cleanTag = tag.replace(/[\w]+:/g, '');
  // AUD-04 FIX: Use non-capturing group (?:ns:)? to avoid consuming the tag name as a namespace prefix
  const pattern = new RegExp(
    `<(?:[\\w]+:)?${escapeRegex(cleanTag)}[^>]*>([\\s\\S]*?)</(?:[\\w]+:)?${escapeRegex(cleanTag)}>`,
    'gi'
  );
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    results.push(match[1]);
  }
  return results;
}

/**
 * Parse float from string, handling Brazilian format (comma as decimal)
 */
function parseNumber(value: string | null): number {
  if (!value) return 0;
  // AUD-04 FIX: Handle Brazilian thousand-separator format: 1.234,56 -> 1234.56
  // The original regex /\.(?=\d{3})/g incorrectly removed the decimal point in NF-e values
  // like '10.0000' (ten with 4 decimal places) converting it to 100000.
  // A thousands separator dot is followed by EXACTLY 3 digits then another dot, comma, or end.
  // A decimal dot (NF-e style) is followed by 4+ digits like '0000'.
  const cleaned = value.replace(/\s/g, '')
    // Remove thousand separator dots: dot followed by exactly 3 digits then (dot|comma|end)
    .replace(/\.(\d{3})(?=[.,]|$)/g, '$1')
    // Convert Brazilian decimal comma to dot
    .replace(',', '.');
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

/**
 * Extract ICMS value from item block - handles various ICMS CST types
 */
function extractIcmsFromItem(itemBlock: string): { vBC: number; vICMS: number; cst?: string; csosn?: string } {
  // Try various ICMS CST types: ICMS00, ICMS10, ICMS20, ICMS30, ICMS40, ICMS41, ICMS50, ICMS51, ICMS60, ICMS70, ICMS90
  const icmsTypes = ['ICMS00', 'ICMS10', 'ICMS20', 'ICMS30', 'ICMS40', 'ICMS41', 'ICMS50', 'ICMS51', 'ICMS60', 'ICMS70', 'ICMS90'];
  const icmsSnTypes = ['ICMSSN101', 'ICMSSN102', 'ICMSSN201', 'ICMSSN202', 'ICMSSN500', 'ICMSSN900'];

  // Try regular ICMS first
  for (const type of icmsTypes) {
    const block = extractBlock(itemBlock, `ICMS/${type}`);
    if (block) {
      const vBC = parseNumber(extractValue(block, ['vBC']));
      const vICMS = parseNumber(extractValue(block, ['vICMS']));
      const cst = extractValue(block, ['CST']);
      return { vBC, vICMS, cst: cst || undefined };
    }
  }

  // Try Simples Nacional ICMS
  for (const type of icmsSnTypes) {
    const block = extractBlock(itemBlock, `ICMS/${type}`);
    if (block) {
      const vBC = parseNumber(extractValue(block, ['vBC']));
      const vICMS = parseNumber(extractValue(block, ['vICMS']));
      const csosn = extractValue(block, ['CSOSN']);
      return { vBC, vICMS, csosn: csosn || undefined };
    }
  }

  return { vBC: 0, vICMS: 0 };
}

/**
 * Extract IPI value from item block
 */
function extractIpiFromItem(itemBlock: string): number {
  // Try IPITrib first (taxed IPI)
  const ipiTribBlock = extractBlock(itemBlock, 'IPI/IPITrib');
  if (ipiTribBlock) {
    return parseNumber(extractValue(ipiTribBlock, ['vIPI']));
  }
  // IPINT = IPI não tributado
  return 0;
}

/**
 * Extract PIS value from item block
 */
function extractPisFromItem(itemBlock: string): number {
  const pisAliqBlock = extractBlock(itemBlock, 'PIS/PISAliq');
  if (pisAliqBlock) {
    return parseNumber(extractValue(pisAliqBlock, ['vPIS']));
  }
  const pisQtdeBlock = extractBlock(itemBlock, 'PIS/PISQtde');
  if (pisQtdeBlock) {
    return parseNumber(extractValue(pisQtdeBlock, ['vPIS']));
  }
  return 0;
}

/**
 * Extract COFINS value from item block
 */
function extractCofinsFromItem(itemBlock: string): number {
  const cofinsAliqBlock = extractBlock(itemBlock, 'COFINS/COFINSAliq');
  if (cofinsAliqBlock) {
    return parseNumber(extractValue(cofinsAliqBlock, ['vCOFINS']));
  }
  const cofinsQtdeBlock = extractBlock(itemBlock, 'COFINS/COFINSQtde');
  if (cofinsQtdeBlock) {
    return parseNumber(extractValue(cofinsQtdeBlock, ['vCOFINS']));
  }
  return 0;
}

/**
 * Extract the 44-digit chave de acesso from the XML
 */
function extractChave(xml: string): string | null {
  // Try from infNFe Id attribute
  const idMatch = xml.match(/Id=["']NFe(\d{44})["']/i);
  if (idMatch) return idMatch[1];

  // Try from chave tag
  const chave = extractValue(xml, ['chNFe', 'chave']);
  if (chave) return chave.replace(/\D/g, '');

  return null;
}

/**
 * Validate chave de acesso (44 digits + dígito verificador)
 * O dígito verificador é calculado com base nos 43 primeiros dígitos
 * usando módulo 11 com pesos decrescentes de 2 a 9
 */
export function validateChave(chave: string): boolean {
  const cleaned = chave.replace(/\D/g, '')
  if (cleaned.length !== 44) return false

  // Verificar dígito verificador
  const dv = calculateChaveDV(cleaned.substring(0, 43))
  return dv === parseInt(cleaned[43], 10)
}

/**
 * Calcula o dígito verificador da chave de acesso NF-e
 * Usado para validação integral da chave
 */
function calculateChaveDV(base43: string): number {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9]
  let soma = 0
  let pesoIdx = 0

  // Percorrer da direita para a esquerda
  for (let i = base43.length - 1; i >= 0; i--) {
    soma += parseInt(base43[i], 10) * pesos[pesoIdx % pesos.length]
    pesoIdx++
  }

  const resto = soma % 11
  return resto <= 1 ? 0 : 11 - resto
}

/**
 * Validate CNPJ (14 digits + check digit verification)
 * SEC-02 FIX: Added modulo 11 check digit validation
 */
export function validateCnpj(cnpj: string): boolean {
  const cleaned = cnpj.replace(/\D/g, '')
  if (cleaned.length !== 14) return false

  // Reject known invalid sequences (all same digit)
  if (/^(\d)\1{13}$/.test(cleaned)) return false

  // Calculate first check digit
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  let sum = 0
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cleaned[i], 10) * weights1[i]
  }
  let remainder = sum % 11
  const dv1 = remainder < 2 ? 0 : 11 - remainder

  if (parseInt(cleaned[12], 10) !== dv1) return false

  // Calculate second check digit
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  sum = 0
  for (let i = 0; i < 13; i++) {
    sum += parseInt(cleaned[i], 10) * weights2[i]
  }
  remainder = sum % 11
  const dv2 = remainder < 2 ? 0 : 11 - remainder

  return parseInt(cleaned[13], 10) === dv2
}

/**
 * Extrai dados de endereço de um bloco XML (enderEmit, enderDest)
 */
function extractEndereco(block: string): ParsedNFe['emitente']['endereco'] {
  return {
    logradouro: extractValue(block, ['xLgr']),
    numero: extractValue(block, ['nro']),
    complemento: extractValue(block, ['xCpl']),
    bairro: extractValue(block, ['xBairro']),
    codMunicipio: extractValue(block, ['cMun']),
    municipio: extractValue(block, ['xMun']),
    uf: extractValue(block, ['UF']),
    cep: extractValue(block, ['CEP']),
    fone: extractValue(block, ['fone']),
  }
}

/**
 * Extrai dados completos do emitente
 */
function extractEmitente(infNFeBlock: string): NFeEmitente {
  const emitBlock = extractBlock(infNFeBlock, 'emit')
  if (!emitBlock) {
    throw new Error('Bloco emit (fornecedor) não encontrado no XML')
  }

  const cnpj = extractValue(emitBlock, ['CNPJ'])?.replace(/\D/g, '') || ''
  const razaoSocial = extractValue(emitBlock, ['xNome']) || ''
  const nomeFantasia = extractValue(emitBlock, ['xFant'])
  const ie = extractValue(emitBlock, ['IE'])
  const im = extractValue(emitBlock, ['IM'])
  const cnae = extractValue(emitBlock, ['CNAE'])
  const crt = extractValue(emitBlock, ['CRT'])

  // Extrair endereço do emitente
  const enderEmitBlock = extractBlock(emitBlock, 'enderEmit')
  const endereco = enderEmitBlock
    ? extractEndereco(enderEmitBlock)
    : {
        logradouro: null, numero: null, complemento: null, bairro: null,
        codMunicipio: null, municipio: null, uf: null, cep: null, fone: null,
      }

  return {
    cnpj,
    razaoSocial,
    nomeFantasia,
    ie,
    im,
    cnae,
    crt,
    endereco,
  }
}

/**
 * Extrai dados completos do destinatário
 */
function extractDestinatario(infNFeBlock: string): NFeDestinatario {
  const destBlock = extractBlock(infNFeBlock, 'dest')
  if (!destBlock) {
    return {
      cnpj: null, cpf: null, razaoSocial: null, ie: null,
      endereco: {
        logradouro: null, numero: null, bairro: null,
        codMunicipio: null, municipio: null, uf: null, cep: null,
      },
    }
  }

  const cnpj = extractValue(destBlock, ['CNPJ'])?.replace(/\D/g, '') || null
  const cpf = extractValue(destBlock, ['CPF'])?.replace(/\D/g, '') || null
  const razaoSocial = extractValue(destBlock, ['xNome'])
  const ie = extractValue(destBlock, ['IE'])

  const enderDestBlock = extractBlock(destBlock, 'enderDest')
  const endereco = enderDestBlock
    ? {
        logradouro: extractValue(enderDestBlock, ['xLgr']),
        numero: extractValue(enderDestBlock, ['nro']),
        bairro: extractValue(enderDestBlock, ['xBairro']),
        codMunicipio: extractValue(enderDestBlock, ['cMun']),
        municipio: extractValue(enderDestBlock, ['xMun']),
        uf: extractValue(enderDestBlock, ['UF']),
        cep: extractValue(enderDestBlock, ['CEP']),
      }
    : {
        logradouro: null, numero: null, bairro: null,
        codMunicipio: null, municipio: null, uf: null, cep: null,
      }

  return { cnpj, cpf, razaoSocial, ie, endereco }
}

/**
 * Extrai duplicatas (parcelas de pagamento) do XML
 */
function extractDuplicatas(infNFeBlock: string): NFeDuplicata[] {
  const cobrBlock = extractBlock(infNFeBlock, 'cobr')
  if (!cobrBlock) return []

  const dupBlocks = extractAllBlocks(cobrBlock, 'dup')
  return dupBlocks.map((dupBlock) => ({
    nDup: extractValue(dupBlock, ['nDup']) || '',
    dVenc: extractValue(dupBlock, ['dVenc']) || '',
    vDup: parseNumber(extractValue(dupBlock, ['vDup'])),
  })).filter(d => d.nDup || d.vDup > 0)
}

/**
 * Extrai dados de transporte do XML
 */
function extractTransporte(infNFeBlock: string): NFeTransporte | null {
  const transpBlock = extractBlock(infNFeBlock, 'transp')
  if (!transpBlock) return null

  const modFrete = extractValue(transpBlock, ['modFrete']) || '9'

  // Dados da transportadora
  const transportaBlock = extractBlock(transpBlock, 'transporta')
  const transportadoraCnpj = transportaBlock
    ? (extractValue(transportaBlock, ['CNPJ'])?.replace(/\D/g, '') || null)
    : null
  const transportadoraNome = transportaBlock
    ? extractValue(transportaBlock, ['xNome'])
    : null
  const transportadoraIe = transportaBlock
    ? extractValue(transportaBlock, ['IE'])
    : null

  // Dados do veículo
  const veicBlock = extractBlock(transpBlock, 'veicTransp')
  const veiculoPlaca = veicBlock ? extractValue(veicBlock, ['placa']) : null
  const veiculoUf = veicBlock ? extractValue(veicBlock, ['UF']) : null

  // Volumes
  const volBlocks = extractAllBlocks(transpBlock, 'vol')
  const volumes = volBlocks.map((volBlock) => ({
    qVol: parseNumber(extractValue(volBlock, ['qVol'])) || null,
    esp: extractValue(volBlock, ['esp']),
    marca: extractValue(volBlock, ['marca']),
    nVol: extractValue(volBlock, ['nVol']),
    pesoL: parseNumber(extractValue(volBlock, ['pesoL'])) || null,
    pesoB: parseNumber(extractValue(volBlock, ['pesoB'])) || null,
  }))

  return {
    modFrete,
    transportadoraCnpj,
    transportadoraNome,
    transportadoraIe,
    veiculoPlaca,
    veiculoUf,
    volumes,
  }
}

/**
 * SECURITY: Validate XML for XXE and XML bomb attacks before parsing
 */
function validateXmlSecurity(xml: string): void {
  // Size limit: 5MB max to prevent XML bomb / memory exhaustion
  if (xml.length > 5 * 1024 * 1024) {
    throw new Error('XML excede o tamanho máximo permitido (5MB)')
  }

  // Block DOCTYPE declarations (XXE vector)
  if (/<!DOCTYPE/i.test(xml)) {
    throw new Error('XML contém declaração DOCTYPE não permitida por razões de segurança')
  }

  // Block ENTITY declarations (XML bomb / XXE vector)
  if (/<!ENTITY/i.test(xml)) {
    throw new Error('XML contém declarações de entidade não permitidas por razões de segurança')
  }

  // Block external entity references
  if (/<!\[CDATA\[/i.test(xml) === false) {
    // Check for entity references that could be external
    if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)[\w]+;/i.test(xml)) {
      // Only warn — some legitimate NF-e XMLs use custom entities
      // But we should be cautious
    }
  }

  // Check for suspicious processing instructions
  if (/<\?xml-stylesheet/i.test(xml)) {
    throw new Error('XML contém instruções de processamento não permitidas')
  }
}

/**
 * Main parser function - parses NF-e XML content
 */
export function parseNFeXml(xmlContent: string): ParsedNFe {
  // Clean XML - remove BOM and normalize
  const xml = xmlContent.replace(/^\uFEFF/, '').trim();

  // SECURITY: Validate XML before parsing
  validateXmlSecurity(xml);

  // Extract chave
  const chave = extractChave(xml);
  if (!chave) {
    throw new Error('Chave de acesso não encontrada no XML');
  }

  // Extract header data from infNFe
  const infNFeBlock = extractBlock(xml, 'infNFe');
  if (!infNFeBlock) {
    throw new Error('Bloco infNFe não encontrado no XML');
  }

  // Extract numero, serie, data emissao, natureza operacao
  const numero = extractValue(infNFeBlock, ['nNF']) || '';
  const serie = extractValue(infNFeBlock, ['serie']) || '';
  const dataEmissao = extractValue(infNFeBlock, ['dhEmi', 'dEmi']) || '';
  const naturezaOperacao = extractValue(infNFeBlock, ['natOp']) || '';

  // Extract complete emitente data
  const emitente = extractEmitente(infNFeBlock)

  // Extract complete destinatario data
  const destinatario = extractDestinatario(infNFeBlock)

  // Legacy fields for backward compatibility
  const supplierCnpj = emitente.cnpj
  const supplierRazaoSocial = emitente.razaoSocial
  const destCnpj = destinatario.cnpj || undefined

  // Extract items (det)
  const detBlocks = extractAllBlocks(infNFeBlock, 'det');
  const items: NFeItem[] = detBlocks.map((detBlock) => {
    const prodBlock = extractBlock(detBlock, 'prod');
    if (!prodBlock) {
      return {
        cProd: '', xProd: '', ncm: '', cfop: '',
        qCom: 0, uCom: 'UN', vUnCom: 0, vProd: 0,
        vBC_Icms: 0, vICMS: 0, vIPI: 0, vPIS: 0, vCOFINS: 0,
      };
    }

    const icmsData = extractIcmsFromItem(detBlock);

    return {
      cProd: extractValue(prodBlock, ['cProd']) || '',
      xProd: extractValue(prodBlock, ['xProd']) || '',
      ncm: extractValue(prodBlock, ['NCM']) || '',
      cfop: extractValue(prodBlock, ['CFOP']) || '',
      qCom: parseNumber(extractValue(prodBlock, ['qCom'])),
      uCom: extractValue(prodBlock, ['uCom']) || 'UN',
      vUnCom: parseNumber(extractValue(prodBlock, ['vUnCom'])),
      vProd: parseNumber(extractValue(prodBlock, ['vProd'])),
      vBC_Icms: icmsData.vBC,
      vICMS: icmsData.vICMS,
      vIPI: extractIpiFromItem(detBlock),
      vPIS: extractPisFromItem(detBlock),
      vCOFINS: extractCofinsFromItem(detBlock),
      cst: icmsData.cst,
      csosn: icmsData.csosn,
    };
  });

  // Extract totals (expanded)
  const totalBlock = extractBlock(infNFeBlock, 'total/ICMSTot');
  const totals: NFeTotals = {
    vBC: parseNumber(extractValue(totalBlock || '', ['vBC'])),
    vICMS: parseNumber(extractValue(totalBlock || '', ['vICMS'])),
    vIPI: parseNumber(extractValue(totalBlock || '', ['vIPI'])),
    vPIS: parseNumber(extractValue(totalBlock || '', ['vPIS'])),
    vCOFINS: parseNumber(extractValue(totalBlock || '', ['vCOFINS'])),
    vNF: parseNumber(extractValue(totalBlock || '', ['vNF'])),
    vST: parseNumber(extractValue(totalBlock || '', ['vST'])),
    vFCP: parseNumber(extractValue(totalBlock || '', ['vFCP'])),
    vFrete: parseNumber(extractValue(totalBlock || '', ['vFrete'])),
    vSeg: parseNumber(extractValue(totalBlock || '', ['vSeg'])),
    vDesc: parseNumber(extractValue(totalBlock || '', ['vDesc'])),
    vOutro: parseNumber(extractValue(totalBlock || '', ['vOutro'])),
  };

  // Extract frete (legacy compatibility)
  const vFrete = totals.vFrete;

  // Extract complementary info
  const infCpl = extractValue(infNFeBlock, ['infCpl']);
  const infAdFisco = extractValue(infNFeBlock, ['infAdFisco']);

  // Extract duplicatas (parcelas)
  const duplicatas = extractDuplicatas(infNFeBlock);

  // Extract transporte
  const transporte = extractTransporte(infNFeBlock);

  // Extract forma de pagamento
  const pagBlock = extractBlock(infNFeBlock, 'pag')
  const formaPagamento = pagBlock ? extractValue(pagBlock, ['tPag']) : null

  return {
    chave,
    numero,
    serie,
    dataEmissao,
    naturezaOperacao,
    supplierCnpj,
    supplierRazaoSocial,
    emitente,
    destCnpj,
    destinatario,
    items,
    totals,
    vFrete,
    infCpl: infCpl || undefined,
    infAdFisco: infAdFisco || undefined,
    duplicatas,
    transporte,
    formaPagamento,
  };
}

/**
 * Validate XML basic structure
 */
export function validateXmlStructure(xmlContent: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const xml = xmlContent.replace(/^\uFEFF/, '').trim();

  // Check if it looks like XML
  if (!xml.startsWith('<')) {
    errors.push('Conteúdo não parece ser um XML válido');
  }

  // Check for NFe root element
  if (!xml.includes('NFe') && !xml.includes('nfeProc')) {
    errors.push('XML não contém elemento raiz NFe ou nfeProc');
  }

  // Check for infNFe
  if (!xml.includes('infNFe')) {
    errors.push('XML não contém bloco infNFe');
  }

  // Check for emit
  if (!xml.includes('emit')) {
    errors.push('XML não contém bloco emit (fornecedor)');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
