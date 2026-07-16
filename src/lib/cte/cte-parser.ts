/**
 * CT-e XML Parser
 * Extrai dados de XML de Conhecimento de Transporte Eletrônico brasileiro
 * Conforme leiaute CT-e 4.00 (NT 2018.005 e atualizações)
 * Usa regex/string parsing para evitar dependências pesadas
 */

// AUD-H03 FIX: Add XXE protection (DOCTYPE/ENTITY blocking + size limit)
// Same protection as NF-e xml-parser.ts
const MAX_CTE_XML_SIZE = 5 * 1024 * 1024; // 5MB

function validateCteXmlSafety(xmlContent: string): void {
  if (xmlContent.length > MAX_CTE_XML_SIZE) {
    throw new Error(`XML do CT-e excede o tamanho máximo permitido (${MAX_CTE_XML_SIZE / 1024 / 1024}MB)`);
  }
  const upperXml = xmlContent.toUpperCase();
  if (upperXml.includes('<!DOCTYPE') || upperXml.includes('<!ENTITY')) {
    throw new Error('XML do CT-e contém DOCTYPE/ENTITY proibidos (proteção XXE)');
  }
}

export interface ParsedCte {
  chave: string
  numero: string
  serie: string
  dataEmissao: string
  tipoCte: string         // CTE (normal), CTE_OS (Ordem de Serviço)
  modal: string           // 01-Rodoviário, 02-Aéreo, 03-Aquaviário, 04-Ferroviário, 05-Dutoviário, 06-Multimodal
  naturezaOperacao: string // Normal, Complementar, Anulação, Substituto
  emitente: {
    cnpj: string
    razaoSocial: string
    ie: string | null
    endereco: {
      logradouro: string | null
      numero: string | null
      complemento: string | null
      bairro: string | null
      codMunicipio: string | null
      municipio: string | null
      uf: string | null
      cep: string | null
      fone: string | null
    }
  }
  destinatario: {
    cnpj: string | null
    cpf: string | null
    razaoSocial: string | null
  }
  valorTotal: number
  valorImpostos: {
    vICMS: number
    vST: number
    vNF: number
    vICMSUFFim: number
    vFCPUFFim: number
    vICMSUIIni: number
    vFCPUFIni: number
  }
  nfeVinculadas: string[]  // Chaves das NF-e vinculadas ao CT-e
  infCpl?: string          // Informações complementares
}

// =============================================
// Helpers
// =============================================

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extrai valor de tag XML usando regex
 * Lida com namespaces removendo prefixos
 */
function extractValue(xml: string, tag: string): string | null {
  const cleanTag = tag.replace(/[\w]+:/g, '')
  const patterns = [
    new RegExp(`<[\\w]*:?${escapeRegex(cleanTag)}[^>]*>([^<]+)</[\\w]*:?${escapeRegex(cleanTag)}>`, 'i'),
    new RegExp(`<${escapeRegex(cleanTag)}[^>]*>([^<]+)</${escapeRegex(cleanTag)}>`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = xml.match(pattern)
    if (match && match[1]) return match[1].trim()
  }
  return null
}

/**
 * Extrai bloco XML (conteúdo entre tags de abertura e fechamento)
 */
function extractBlock(xml: string, tag: string): string | null {
  const cleanTag = tag.replace(/[\w]+:/g, '')
  const pattern = new RegExp(
    `<[\\w]*:?${escapeRegex(cleanTag)}[^>]*>([\\s\\S]*?)</[\\w]*:?${escapeRegex(cleanTag)}>`,
    'i'
  )
  const match = xml.match(pattern)
  return match ? match[1] : null
}

/**
 * Extrai todos os blocos de um elemento XML repetitivo
 */
function extractAllBlocks(xml: string, tag: string): string[] {
  const results: string[] = []
  const cleanTag = tag.replace(/[\w]+:/g, '')
  const pattern = new RegExp(
    `<[\\w]*:?${escapeRegex(cleanTag)}[^>]*>([\\s\\S]*?)</[\\w]*:?${escapeRegex(cleanTag)}>`,
    'gi'
  )
  let match
  while ((match = pattern.exec(xml)) !== null) {
    results.push(match[1])
  }
  return results
}

/**
 * Parse float from string, handling Brazilian format
 */
function parseNumber(value: string | null): number {
  if (!value) return 0
  const cleaned = value.replace(/\s/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.')
  const num = parseFloat(cleaned)
  return isNaN(num) ? 0 : num
}

// =============================================
// Chave de Acesso Validation
// =============================================

/**
 * Calcula o dígito verificador da chave de acesso
 * Usado para validação integral da chave
 */
function calculateChaveDV(base43: string): number {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9]
  let soma = 0
  let pesoIdx = 0

  for (let i = base43.length - 1; i >= 0; i--) {
    soma += parseInt(base43[i], 10) * pesos[pesoIdx % pesos.length]
    pesoIdx++
  }

  const resto = soma % 11
  return resto <= 1 ? 0 : 11 - resto
}

/**
 * Valida chave de acesso CT-e (44 dígitos + dígito verificador)
 * A estrutura da chave CT-e é a mesma da NF-e:
 * Posições 1-2:  Código da UF
 * Posições 3-4:  Ano de emissão (AA)
 * Posições 5-6:  Mês de emissão (MM)
 * Posições 7-14: CNPJ do emitente
 * Posições 15-17: Modelo (57=CT-e, 67=CT-e OS)
 * Posições 18-21: Série
 * Posições 22-33: Número
 * Posições 34-42: Código numérico
 * Posição 43-44:  DV
 */
export function validateCteChave(chave: string): boolean {
  const cleaned = chave.replace(/\D/g, '')
  if (cleaned.length !== 44) return false

  // Verificar modelo CT-e (posição 15-17): 57 ou 67
  const modelo = parseInt(cleaned.substring(15, 18), 10)
  if (modelo !== 57 && modelo !== 67) return false

  // Verificar dígito verificador
  const dv = calculateChaveDV(cleaned.substring(0, 43))
  return dv === parseInt(cleaned[43], 10)
}

/**
 * Extrai modelo do CT-e a partir da chave de acesso
 */
export function extractModelFromChave(chave: string): 'CTE' | 'CTE_OS' {
  const cleaned = chave.replace(/\D/g, '')
  if (cleaned.length < 18) return 'CTE'
  const modelo = parseInt(cleaned.substring(15, 18), 10)
  return modelo === 67 ? 'CTE_OS' : 'CTE'
}

// =============================================
// CT-e XML Parsing Functions
// =============================================

/**
 * Extrai a chave de acesso (44 dígitos) do XML do CT-e
 */
function extractCteChave(xml: string): string | null {
  // Tentar pelo atributo Id de infCte
  const idMatch = xml.match(/Id=["']CTe(\d{44})["']/i)
  if (idMatch) return idMatch[1]

  // Tentar pela tag chCTe
  const chCTe = extractValue(xml, 'chCTe')
  if (chCTe) return chCTe.replace(/\D/g, '')

  // Tentar pela tag chave
  const chave = extractValue(xml, 'chave')
  if (chave) return chave.replace(/\D/g, '')

  return null
}

/**
 * Extrai dados de endereço de um bloco XML (enderEmit, enderRem, enderDest, etc.)
 */
function extractEndereco(block: string): ParsedCte['emitente']['endereco'] {
  return {
    logradouro: extractValue(block, 'xLgr'),
    numero: extractValue(block, 'nro'),
    complemento: extractValue(block, 'xCpl'),
    bairro: extractValue(block, 'xBairro'),
    codMunicipio: extractValue(block, 'cMun'),
    municipio: extractValue(block, 'xMun'),
    uf: extractValue(block, 'UF'),
    cep: extractValue(block, 'CEP'),
    fone: extractValue(block, 'fone'),
  }
}

/**
 * Extrai dados completos do emitente do CT-e
 */
function extractEmitente(infCteBlock: string): ParsedCte['emitente'] {
  const emitBlock = extractBlock(infCteBlock, 'emit')
  if (!emitBlock) {
    throw new Error('Bloco emit (emitente) não encontrado no XML do CT-e')
  }

  const cnpj = extractValue(emitBlock, 'CNPJ')?.replace(/\D/g, '') || ''
  const razaoSocial = extractValue(emitBlock, 'xNome') || ''
  const ie = extractValue(emitBlock, 'IE')

  const enderEmitBlock = extractBlock(emitBlock, 'enderEmit')
  const endereco = enderEmitBlock
    ? extractEndereco(enderEmitBlock)
    : {
        logradouro: null, numero: null, complemento: null, bairro: null,
        codMunicipio: null, municipio: null, uf: null, cep: null, fone: null,
      }

  return { cnpj, razaoSocial, ie, endereco }
}

/**
 * Extrai dados do destinatário do CT-e
 * O destinatário pode ter CNPJ ou CPF
 */
function extractDestinatario(infCteBlock: string): ParsedCte['destinatario'] {
  // No CT-e, o destinatário pode estar em 'dest' ou 'receb' (CT-e OS)
  const destBlock = extractBlock(infCteBlock, 'dest') || extractBlock(infCteBlock, 'receb')

  if (!destBlock) {
    return { cnpj: null, cpf: null, razaoSocial: null }
  }

  const cnpj = extractValue(destBlock, 'CNPJ')?.replace(/\D/g, '') || null
  const cpf = extractValue(destBlock, 'CPF')?.replace(/\D/g, '') || null
  const razaoSocial = extractValue(destBlock, 'xNome')

  return { cnpj, cpf, razaoSocial }
}

/**
 * Mapeia código do modal para descrição
 */
function mapModal(modal: string): string {
  const modalMap: Record<string, string> = {
    '01': 'Rodoviário',
    '02': 'Aéreo',
    '03': 'Aquaviário',
    '04': 'Ferroviário',
    '05': 'Dutoviário',
    '06': 'Multimodal',
  }
  return modalMap[modal] || modal
}

/**
 * Mapeia código da natureza de operação para descrição
 */
function mapNaturezaOperacao(tpOp: string): string {
  const natMap: Record<string, string> = {
    '0': 'Normal',
    '1': 'Complementar',
    '2': 'Anulação',
    '3': 'Substituto',
  }
  return natMap[tpOp] || tpOp
}

/**
 * Extrai as chaves das NF-e vinculadas ao CT-e
 * No CT-e, as NF-e vinculadas aparecem em:
 * - infCTeNorm/infDoc/infNFe/chave
 * - infCTeNorm/infDoc/infNF (modelo 01/1A/02 - não é eletrônica)
 * - comp/Chave (CT-e de complemento referencia outro CT-e)
 */
function extractNfeVinculadas(infCteBlock: string): string[] {
  const chaves: string[] = []

  // Extrair do bloco infCTeNorm
  const infCTeNormBlock = extractBlock(infCteBlock, 'infCTeNorm')
  if (infCTeNormBlock) {
    // NF-e vinculadas (infNFe/chave)
    const infDocBlock = extractBlock(infCTeNormBlock, 'infDoc')
    if (infDocBlock) {
      const infNFeBlocks = extractAllBlocks(infDocBlock, 'infNFe')
      for (const infNFe of infNFeBlocks) {
        const chave = extractValue(infNFe, 'chave')
        if (chave && chave.replace(/\D/g, '').length === 44) {
          chaves.push(chave.replace(/\D/g, ''))
        }
      }
    }

    // CT-e complementado (comp/Chave)
    const compBlock = extractBlock(infCTeNormBlock, 'comp')
    if (compBlock) {
      const chaveComp = extractValue(compBlock, 'Chave')
      if (chaveComp && chaveComp.replace(/\D/g, '').length === 44) {
        chaves.push(chaveComp.replace(/\D/g, ''))
      }
    }
  }

  // Também verificar em infCteComp (CT-e de complemento)
  const infCteCompBlock = extractBlock(infCteBlock, 'infCteComp')
  if (infCteCompBlock) {
    const chaveComp = extractValue(infCteCompBlock, 'chCTe')
    if (chaveComp && chaveComp.replace(/\D/g, '').length === 44) {
      chaves.push(chaveComp.replace(/\D/g, ''))
    }
  }

  return chaves
}

/**
 * Extrai valores totais e de impostos do CT-e
 */
function extractValores(infCteBlock: string): ParsedCte['valorImpostos'] {
  // O vRec (valor do recebedor) é o valor total do CT-e
  const vRec = parseNumber(extractValue(infCteBlock, 'vRec'))

  // Buscar bloco de impostos (imp)
  const impBlock = extractBlock(infCteBlock, 'imp')
  if (!impBlock) {
    return { vICMS: 0, vST: 0, vNF: vRec, vICMSUFFim: 0, vFCPUFFim: 0, vICMSUIIni: 0, vFCPUFIni: 0 }
  }

  // ICMS - tentar vários tipos: ICMS00, ICMS20, ICMS45, ICMS60, ICMS90, ICMSSN, etc.
  const icmsTypes = ['ICMS00', 'ICMS20', 'ICMS45', 'ICMS60', 'ICMS90', 'ICMSSN', 'ICMSOutraUF']
  let vICMS = 0
  for (const type of icmsTypes) {
    const block = extractBlock(impBlock, `ICMS/${type}`)
    if (block) {
      vICMS = parseNumber(extractValue(block, 'vICMS'))
      break
    }
  }

  // ICMS ST
  let vST = 0
  for (const type of ['ICMS90', 'ICMSSN']) {
    const block = extractBlock(impBlock, `ICMS/${type}`)
    if (block) {
      vST = parseNumber(extractValue(block, 'vICMSST'))
      break
    }
  }

  // Partilha ICMS
  const vICMSUFFim = parseNumber(extractValue(impBlock, 'vICMSUFFim'))
  const vFCPUFFim = parseNumber(extractValue(impBlock, 'vFCPUFFim'))
  const vICMSUIIni = parseNumber(extractValue(impBlock, 'vICMSUFIni'))
  const vFCPUFIni = parseNumber(extractValue(impBlock, 'vFCPUFIni'))

  return {
    vICMS,
    vST,
    vNF: vRec,
    vICMSUFFim,
    vFCPUFFim,
    vICMSUIIni,
    vFCPUFIni,
  }
}

/**
 * Main parser function - parses CT-e XML content
 */
export function parseCteXml(xmlContent: string): ParsedCte {
  // AUD-H03 FIX: Validate XML safety before parsing
  validateCteXmlSafety(xmlContent);

  // Clean XML - remove BOM and normalize
  const xml = xmlContent.replace(/^\uFEFF/, '').trim()

  // Extract chave
  const chave = extractCteChave(xml)
  if (!chave) {
    throw new Error('Chave de acesso CT-e não encontrada no XML')
  }

  // Extract header data from infCte
  const infCteBlock = extractBlock(xml, 'infCte')
  if (!infCteBlock) {
    throw new Error('Bloco infCte não encontrado no XML do CT-e')
  }

  // Extrair dados do ide (identificação do CT-e)
  const ideBlock = extractBlock(infCteBlock, 'ide')

  const numero = ideBlock ? (extractValue(ideBlock, 'nCT') || '') : ''
  const serie = ideBlock ? (extractValue(ideBlock, 'serie') || '') : ''
  const dataEmissao = ideBlock ? (extractValue(ideBlock, 'dhEmi') || '') : ''

  // Tipo de operação / natureza
  const tpOp = ideBlock ? (extractValue(ideBlock, 'tpOp') || '0') : '0'
  const naturezaOperacao = mapNaturezaOperacao(tpOp)

  // Modal
  const modalCode = ideBlock ? (extractValue(ideBlock, 'modal') || '01') : '01'
  const modal = mapModal(modalCode)

  // Tipo CT-e (baseado na chave de acesso - modelo 57=CT-e, 67=CT-e OS)
  const tipoCte = extractModelFromChave(chave)

  // Emitente
  const emitente = extractEmitente(infCteBlock)

  // Destinatário
  const destinatario = extractDestinatario(infCteBlock)

  // Valores
  const valorImpostos = extractValores(infCteBlock)

  // NF-e vinculadas
  const nfeVinculadas = extractNfeVinculadas(infCteBlock)

  // Informações complementares
  const infCpl = extractValue(infCteBlock, 'infCpl')

  return {
    chave,
    numero,
    serie,
    dataEmissao,
    tipoCte,
    modal,
    naturezaOperacao,
    emitente,
    destinatario,
    valorTotal: valorImpostos.vNF,
    valorImpostos,
    nfeVinculadas,
    infCpl: infCpl || undefined,
  }
}

/**
 * Validate CT-e XML basic structure
 */
export function validateCteXmlStructure(xmlContent: string): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const xml = xmlContent.replace(/^\uFEFF/, '').trim()

  // Check if it looks like XML
  if (!xml.startsWith('<')) {
    errors.push('Conteúdo não parece ser um XML válido')
  }

  // Check for CTe root element
  if (!xml.includes('CTe') && !xml.includes('cteProc')) {
    errors.push('XML não contém elemento raiz CTe ou cteProc')
  }

  // Check for infCte
  if (!xml.includes('infCte')) {
    errors.push('XML não contém bloco infCte')
  }

  // Check for emit
  if (!xml.includes('emit')) {
    errors.push('XML não contém bloco emit (emitente)')
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
