/**
 * SPED Fiscal (EFD ICMS/IPI) Generator
 * Gerador de arquivo SPED Fiscal conforme Guia Prático da EFD ICMS/IPI
 *
 * Blocos implementados:
 * - Bloco 0: Abertura, Identificação e Referências
 * - Bloco C: Documentos Fiscais I (Mercadorias)
 * - Bloco D: Documentos Fiscais II (Serviços - NFS-e)
 * - Bloco E: Apuração do ICMS e do IPI
 * - Bloco H: Inventário
 * - Bloco 1: Outras Informações
 * - Bloco 9: Controle e Encerramento
 */

import { db } from '@/lib/db'
import { Decimal } from '@prisma/client/runtime/library'

// ============================================
// Types
// ============================================

export interface SpedGeneratorConfig {
  officeId: string
  competencia: string // AAAAMM
  versao?: string // Default "019"
  dataInicio?: Date
  dataFim?: Date
}

export interface SpedGenerationResult {
  success: boolean
  conteudo: string // Full SPED file content
  totalLinhas: number
  totalRegistros: Record<string, number> // Count per block
  errors?: string[]
}

// Internal helper types
interface SpedLine {
  registro: string
  bloco: string
  linha: string
  ordem: number
}

interface CfopResumo {
  cfop: string
  cst: string
  baseIcms: number
  valorIcms: number
  valorIpi: number
  valorPis: number
  valorCofins: number
  valorTotal: number
}

// ============================================
// Formatting helpers
// ============================================

/**
 * Format a number using Brazilian decimal separator (comma)
 * Removes trailing zeros after decimal
 */
function formatNumber(value: number | Decimal | null | undefined, decimals: number = 2): string {
  if (value === null || value === undefined) return ''
  const numVal = typeof value === 'number' ? value : Number(value)
  if (isNaN(numVal)) return ''
  const fixed = numVal.toFixed(decimals)
  // Replace dot with comma for Brazilian format
  return fixed.replace('.', ',')
}

/**
 * Format a Date to DDMMYYYY string
 */
function formatDate(date: Date | null | undefined): string {
  if (!date) return ''
  const d = new Date(date)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = String(d.getFullYear())
  return `${day}${month}${year}`
}

/**
 * Remove non-digit characters from CNPJ/CPF
 */
function onlyDigits(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\D/g, '')
}

/**
 * Build a SPED line from fields: |field1|field2|...|
 */
function buildLine(fields: (string | number | null | undefined)[]): string {
  const parts = fields.map(f => {
    if (f === null || f === undefined) return ''
    return String(f)
  })
  return '|' + parts.join('|') + '|'
}

/**
 * Parse competencia AAAAMM to start/end dates
 */
function parseCompetencia(competencia: string): { dataInicio: Date; dataFim: Date } {
  const ano = parseInt(competencia.substring(0, 4))
  const mes = parseInt(competencia.substring(4, 6))

  const dataInicio = new Date(ano, mes - 1, 1, 0, 0, 0, 0)
  const dataFim = new Date(ano, mes, 0, 23, 59, 59, 999) // last day of month

  return { dataInicio, dataFim }
}

/**
 * Determine the COD_VER (código da versão) from versao string
 */
function getCodVer(versao: string): string {
  const versionMap: Record<string, string> = {
    '019': '019', // Layout 19 (vigente a partir de 2024)
    '018': '018', // Layout 18 (vigente a partir de 2023)
    '017': '017', // Layout 17 (vigente a partir de 2022)
    '016': '016',
    '015': '015',
    '014': '014',
    '013': '013',
    '012': '012',
    '011': '011',
    '010': '010',
    '009': '009',
    '008': '008',
    '007': '007',
    '006': '006',
    '005': '005',
  }
  return versionMap[versao] || '019'
}

/**
 * Determine COD_FIN (finalidade do arquivo):
 * 0 - Remessa do arquivo original
 * 1 - Remessa do arquivo substituto
 */
function getCodFin(): string {
  return '0' // Original submission
}

/**
 * Get IND_PERFIL (perfil de apresentação):
 * A - Perfil A
 * B - Perfil B
 * C - Perfil C
 * Empty - Não enquadrado
 */
function getIndPerfil(): string {
  return '' // For Simples Nacional workshops, typically not assigned
}

/**
 * Get IND_ATIV (indicador de atividade):
 * 0 - Industrial ou equiparado a industrial
 * 1 - Outros
 */
function getIndAtiv(): string {
  return '1' // Mechanic workshops are typically "Outros"
}

// ============================================
// Block generators
// ============================================

/**
 * BLOCO 0 - Abertura, Identificação e Referências
 */
async function generateBloco0(
  config: SpedGeneratorConfig,
  dataInicio: Date,
  dataFim: Date
): Promise<SpedLine[]> {
  const lines: SpedLine[] = []
  let ordem = 0

  // Get office data
  const office = await db.office.findUnique({
    where: { id: config.officeId },
  })
  if (!office) {
    throw new Error('Escritório não encontrado')
  }

  // |0000| - Abertura do arquivo e identificação da entidade
  const codVer = getCodVer(config.versao || '019')
  const codFin = getCodFin()
  const dtIni = formatDate(dataInicio)
  const dtFin = formatDate(dataFim)
  const cnpj = onlyDigits(office.cnpj)
  const nome = office.name
  const uf = office.state || ''
  const ie = '' // Will need to be stored in office model; using empty
  const codMun = '' // IBGE code for municipality
  const im = '' // Inscrição Municipal
  const indPerfil = getIndPerfil()
  const indAtiv = getIndAtiv()

  lines.push({
    registro: '0000',
    bloco: '0',
    linha: buildLine(['0000', codVer, codFin, dtIni, dtFin, cnpj, nome, cnpj.substring(0, 8), uf, ie, codMun, im, indPerfil, indAtiv]),
    ordem: ordem++,
  })

  // |0001| - Abertura do Bloco 0
  // IND_MOV: 0 = com dados, 1 = sem dados
  lines.push({
    registro: '0001',
    bloco: '0',
    linha: buildLine(['0001', '0']),
    ordem: ordem++,
  })

  // |0005| - Dados complementares da entidade
  const fantasia = office.name
  const cep = onlyDigits(office.zipCode)
  const end = office.address || ''
  const num = ''
  const compl = ''
  const bairro = ''
  const fone = onlyDigits(office.phone)
  const fax = ''
  const email = office.email

  lines.push({
    registro: '0005',
    bloco: '0',
    linha: buildLine(['0005', fantasia, cep, end, num, compl, bairro, fone, fax, email]),
    ordem: ordem++,
  })

  // |0100| - Identificação do estabelecimento
  // Contador / responsável pela escrita fiscal
  lines.push({
    registro: '0100',
    bloco: '0',
    linha: buildLine(['0100', 'CONTADOR', '', '', '', '', '', '9999']),
    ordem: ordem++,
  })

  // |0150| - Cadastro do participante (fornecedores e clientes)
  const fornecedores = await db.supplier.findMany({
    where: {
      officeId: config.officeId,
      deleted: false,
    },
  })

  const clientes = await db.client.findMany({
    where: {
      officeId: config.officeId,
      deleted: false,
    },
  })

  const participantes = new Map<string, { codigo: string; nome: string; cnpj: string; ie: string; uf: string; cep: string; endereco: string; numero: string; complemento: string; bairro: string; fone: string; pais: string }>()

  // Add suppliers
  for (const forn of fornecedores) {
    const cnpjLimpo = onlyDigits(forn.cnpj)
    if (!participantes.has(cnpjLimpo)) {
      participantes.set(cnpjLimpo, {
        codigo: `FOR${cnpjLimpo.substring(0, 8)}`,
        nome: forn.razaoSocial,
        cnpj: cnpjLimpo,
        ie: forn.ie || '',
        uf: forn.state || '',
        cep: onlyDigits(forn.zipCode),
        endereco: forn.address || '',
        numero: '',
        complemento: '',
        bairro: '',
        fone: onlyDigits(forn.phone),
        pais: '105', // Brasil
      })
    }
  }

  // Add clients
  for (const cli of clientes) {
    const cpfCnpjLimpo = onlyDigits(cli.cpfCnpj)
    if (cpfCnpjLimpo && !participantes.has(cpfCnpjLimpo)) {
      participantes.set(cpfCnpjLimpo, {
        codigo: `CLI${cpfCnpjLimpo.substring(0, 8)}`,
        nome: cli.name,
        cnpj: cpfCnpjLimpo,
        ie: '',
        uf: cli.state || '',
        cep: onlyDigits(cli.zipCode),
        endereco: cli.address || '',
        numero: '',
        complemento: '',
        bairro: '',
        fone: onlyDigits(cli.phone),
        pais: '105', // Brasil
      })
    }
  }

  for (const [, part] of participantes) {
    const isCnpj = part.cnpj.length === 14
    lines.push({
      registro: '0150',
      bloco: '0',
      linha: buildLine([
        '0150',
        part.codigo,
        part.nome,
        isCnpj ? '00' : '01', // COD_PAIS: 00=CNPJ, 01=CPF
        part.cnpj,
        part.ie,
        part.uf,
        part.cep,
        part.endereco,
        part.numero,
        part.complemento,
        part.bairro,
        part.fone,
        part.pais,
      ]),
      ordem: ordem++,
    })
  }

  // |0190| - Identificação das unidades de medida
  const unidades = new Set<string>()
  // Get units from parts
  const pecas = await db.part.findMany({
    where: {
      officeId: config.officeId,
      deleted: false,
    },
    select: { unit: true },
  })
  for (const p of pecas) {
    if (p.unit) unidades.add(p.unit)
  }
  // Add default
  unidades.add('UN')

  for (const unidade of unidades) {
    lines.push({
      registro: '0190',
      bloco: '0',
      linha: buildLine(['0190', unidade, unidade === 'UN' ? 'UNIDADE' : unidade]),
      ordem: ordem++,
    })
  }

  // |0200| - Identificação dos itens (produtos)
  const itens = await db.part.findMany({
    where: {
      officeId: config.officeId,
      deleted: false,
    },
    orderBy: { sku: 'asc' },
  })

  for (const item of itens) {
    lines.push({
      registro: '0200',
      bloco: '0',
      linha: buildLine([
        '0200',
        item.sku,                     // COD_ITEM
        item.description,             // DESCR_ITEM
        '',                           // COD_BARRA
        item.ncm || '',               // COD_NCM
        '',                           // EX_IPI
        item.cfop || '',              // COD_GEN (gênero)
        '',                           // COD_LST
        item.cst || '',               // ALIQ_ICMS
        item.csosn || '',             // CEST (actually CSOSN, but field position)
        item.unit,                    // UNID_INV
        formatNumber(item.quantity, 3), // QTD_INV
        formatNumber(item.costPrice),   // VAL_INV
      ]),
      ordem: ordem++,
    })
  }

  // |0990| - Encerramento do Bloco 0
  // Count will be updated later
  lines.push({
    registro: '0990',
    bloco: '0',
    linha: buildLine(['0990', '0']), // placeholder count
    ordem: ordem++,
  })

  // Update Block 0 count
  const block0Count = lines.filter(l => l.bloco === '0').length
  const linha0990 = lines.find(l => l.registro === '0990')
  if (linha0990) {
    linha0990.linha = buildLine(['0990', String(block0Count)])
  }

  return lines
}

/**
 * BLOCO C - Documentos Fiscais I (Mercadorias)
 */
async function generateBlocoC(
  config: SpedGeneratorConfig,
  dataInicio: Date,
  dataFim: Date
): Promise<{ lines: SpedLine[]; cfopResumos: CfopResumo[] }> {
  const lines: SpedLine[] = []
  const cfopResumos: CfopResumo[] = []
  let ordem = 0

  // |C001| - Abertura do Bloco C
  // Check if there are invoices in the period
  const invoiceCount = await db.invoice.count({
    where: {
      officeId: config.officeId,
      deleted: false,
      dataEmissao: { gte: dataInicio, lte: dataFim },
    },
  })

  lines.push({
    registro: 'C001',
    bloco: 'C',
    linha: buildLine(['C001', invoiceCount > 0 ? '0' : '1']),
    ordem: ordem++,
  })

  if (invoiceCount > 0) {
    // Get invoices with items for the period
    const invoices = await db.invoice.findMany({
      where: {
        officeId: config.officeId,
        deleted: false,
        dataEmissao: { gte: dataInicio, lte: dataFim },
      },
      include: {
        items: {
          where: { deleted: false },
          orderBy: { createdAt: 'asc' },
        },
        supplier: true,
      },
      orderBy: { dataEmissao: 'asc' },
    })

    // Also get client invoices (saída)
    const clientInvoices = await db.clientInvoice.findMany({
      where: {
        officeId: config.officeId,
        deleted: false,
        dataEmissao: { gte: dataInicio, lte: dataFim },
        status: 'EMITIDA',
      },
      include: {
        items: {
          where: { deleted: false },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { dataEmissao: 'asc' },
    })

    // Process NF-e de entrada (from suppliers)
    for (const inv of invoices) {
      const indOper = '0' // 0=Entrada
      const indEmit = '1' // 1=Terceiros
      const codPart = `FOR${onlyDigits(inv.supplier.cnpj).substring(0, 8)}`
      const codMod = '55' // NF-e
      const codSit = '00' // Documento regular
      const serie = inv.serie
      const numDoc = inv.numero
      const dtDoc = formatDate(inv.dataEmissao)
      const dtES = inv.dataEntrada ? formatDate(inv.dataEntrada) : formatDate(inv.dataEmissao)
      const vlDoc = formatNumber(inv.totalNf)
      const indPgto = '' // Indicador de pagamento
      const vlDesc = formatNumber(inv.desconto)
      const vlAbatNT = '' // Abatimento não tributado
      const vlMerc = formatNumber(inv.subtotal)
      const indFrt = '' // Indicador de frete
      const vlFrt = formatNumber(inv.frete)
      const vlSeg = formatNumber(inv.seguro)
      const vlOutDa = '' // Outras despesas acessórias
      const vlBCICMS = formatNumber(inv.baseIcms)
      const vlICMS = formatNumber(inv.valorIcms)
      const vlBCICMSST = ''
      const vlICMSST = ''
      const vlIPI = formatNumber(inv.valorIpi)
      const vlPIS = formatNumber(inv.valorPis)
      const vlCOFINS = formatNumber(inv.valorCofins)
      const vlPISST = ''
      const vlCOFINSST = ''

      lines.push({
        registro: 'C100',
        bloco: 'C',
        linha: buildLine([
          'C100', indOper, indEmit, codPart, codMod, codSit,
          serie, numDoc, dtDoc, dtES, vlDoc, indPgto,
          vlDesc, vlAbatNT, vlMerc, indFrt, vlFrt, vlSeg,
          vlOutDa, vlBCICMS, vlICMS, vlBCICMSST, vlICMSST,
          vlIPI, vlPIS, vlCOFINS, vlPISST, vlCOFINSST,
        ]),
        ordem: ordem++,
      })

      // |C170| - Itens do documento
      let itemNum = 1
      for (const item of inv.items) {
        const numItem = String(itemNum)
        const codItem = item.sku || item.partId || `ITEM${itemNum}`
        const descrCompl = item.descricao
        const qtd = formatNumber(item.quantidade, 3)
        const und = item.unidade
        const vlItem = formatNumber(item.valorTotal)
        const vlDesc = ''
        const indMov = '' // Movimentação física
        const cst = item.cst || item.csosn || ''
        const cfop = item.cfop
        const codNat = '' // Código da natureza da operação
        const vlBCICMS = formatNumber(item.baseIcms)
        const aliqICMS = Number(item.baseIcms) > 0 && Number(item.valorIcms) > 0 ? formatNumber((Number(item.valorIcms) / Number(item.baseIcms)) * 100) : ''
        const vlICMS = formatNumber(item.valorIcms)
        const vlBCICMSST = ''
        const aliqST = ''
        const vlICMSST = ''
        const indApur = '' // Indicador de apuração do IPI
        const cstIPI = ''
        const codEnq = ''
        const vlBCIPI = ''
        const aliqIPI = Number(item.valorIpi) > 0 && Number(item.valorTotal) > 0 ? formatNumber((Number(item.valorIpi) / Number(item.valorTotal)) * 100) : ''
        const vlIPI = formatNumber(item.valorIpi)
        const cstPIS = ''
        const vlBCPIS = ''
        const aliqPIS = ''
        const quantBCPIS = ''
        const vlPIS = formatNumber(item.valorPis)
        const cstCOFINS = ''
        const vlBCCOFINS = ''
        const aliqCOFINS = ''
        const quantBCCOFINS = ''
        const vlCOFINS = formatNumber(item.valorCofins)
        const codCTA = ''

        lines.push({
          registro: 'C170',
          bloco: 'C',
          linha: buildLine([
            'C170', numItem, codItem, descrCompl, qtd, und,
            vlItem, vlDesc, indMov, cst, cfop, codNat,
            vlBCICMS, aliqICMS, vlICMS, vlBCICMSST, aliqST,
            vlICMSST, indApur, cstIPI, codEnq, vlBCIPI, aliqIPI,
            vlIPI, cstPIS, vlBCPIS, aliqPIS, quantBCPIS, vlPIS,
            cstCOFINS, vlBCCOFINS, aliqCOFINS, quantBCCOFINS, vlCOFINS,
            codCTA,
          ]),
          ordem: ordem++,
        })

        // Aggregate CFOP resumo
        if (cfop) {
          const existing = cfopResumos.find(r => r.cfop === cfop && r.cst === (cst || ''))
          if (existing) {
            existing.baseIcms += Number(item.baseIcms)
            existing.valorIcms += Number(item.valorIcms)
            existing.valorIpi += Number(item.valorIpi)
            existing.valorPis += Number(item.valorPis)
            existing.valorCofins += Number(item.valorCofins)
            existing.valorTotal += Number(item.valorTotal)
          } else {
            cfopResumos.push({
              cfop,
              cst: cst || '',
              baseIcms: Number(item.baseIcms),
              valorIcms: Number(item.valorIcms),
              valorIpi: Number(item.valorIpi),
              valorPis: Number(item.valorPis),
              valorCofins: Number(item.valorCofins),
              valorTotal: Number(item.valorTotal),
            })
          }
        }

        itemNum++
      }
    }

    // Process NF-e de saída (client invoices)
    for (const cinv of clientInvoices) {
      const indOper = '1' // 1=Saída
      const indEmit = '0' // 0=Emissão própria
      const codPart = cinv.destCpfCnpj ? `CLI${onlyDigits(cinv.destCpfCnpj).substring(0, 8)}` : ''
      const codMod = '55' // NF-e
      const codSit = '00' // Documento regular
      const serie = '1'
      const numDoc = cinv.number
      const dtDoc = formatDate(cinv.dataEmissao)
      const dtES = formatDate(cinv.dataEmissao)
      const vlDoc = formatNumber(cinv.totalAmount)
      const indPgto = ''
      const vlDesc = formatNumber(cinv.desconto)
      const vlAbatNT = ''
      const vlMerc = formatNumber(cinv.subtotal)
      const indFrt = ''
      const vlFrt = ''
      const vlSeg = ''
      const vlOutDa = ''
      const vlBCICMS = formatNumber(cinv.baseIcms)
      const vlICMS = formatNumber(cinv.valorIcms)
      const vlBCICMSST = ''
      const vlICMSST = ''
      const vlIPI = formatNumber(cinv.valorIpi)
      const vlPIS = formatNumber(cinv.valorPis)
      const vlCOFINS = formatNumber(cinv.valorCofins)
      const vlPISST = ''
      const vlCOFINSST = ''

      lines.push({
        registro: 'C100',
        bloco: 'C',
        linha: buildLine([
          'C100', indOper, indEmit, codPart, codMod, codSit,
          serie, numDoc, dtDoc, dtES, vlDoc, indPgto,
          vlDesc, vlAbatNT, vlMerc, indFrt, vlFrt, vlSeg,
          vlOutDa, vlBCICMS, vlICMS, vlBCICMSST, vlICMSST,
          vlIPI, vlPIS, vlCOFINS, vlPISST, vlCOFINSST,
        ]),
        ordem: ordem++,
      })

      // |C170| - Itens do documento
      let itemNum = 1
      for (const item of cinv.items) {
        const numItem = String(itemNum)
        const codItem = item.cfop || `ITEM${itemNum}`
        const descrCompl = item.descricao
        const qtd = formatNumber(item.quantidade, 3)
        const und = item.unidade
        const vlItem = formatNumber(item.valorTotal)
        const vlDesc = ''
        const indMov = ''
        const cst = item.cst || item.csosn || ''
        const cfop = item.cfop || ''
        const codNat = ''
        const vlBCICMS = formatNumber(item.baseIcms)
        const aliqICMS = Number(item.baseIcms) > 0 && Number(item.valorIcms) > 0 ? formatNumber((Number(item.valorIcms) / Number(item.baseIcms)) * 100) : ''
        const vlICMS = formatNumber(item.valorIcms)
        const vlBCICMSST = ''
        const aliqST = ''
        const vlICMSST = ''
        const indApur = ''
        const cstIPI = ''
        const codEnq = ''
        const vlBCIPI = ''
        const aliqIPI = Number(item.valorIpi) > 0 && Number(item.valorTotal) > 0 ? formatNumber((Number(item.valorIpi) / Number(item.valorTotal)) * 100) : ''
        const vlIPI = formatNumber(item.valorIpi)
        const cstPIS = ''
        const vlBCPIS = ''
        const aliqPIS = ''
        const quantBCPIS = ''
        const vlPIS = formatNumber(item.valorPis)
        const cstCOFINS = ''
        const vlBCCOFINS = ''
        const aliqCOFINS = ''
        const quantBCCOFINS = ''
        const vlCOFINS = formatNumber(item.valorCofins)
        const codCTA = ''

        lines.push({
          registro: 'C170',
          bloco: 'C',
          linha: buildLine([
            'C170', numItem, codItem, descrCompl, qtd, und,
            vlItem, vlDesc, indMov, cst, cfop, codNat,
            vlBCICMS, aliqICMS, vlICMS, vlBCICMSST, aliqST,
            vlICMSST, indApur, cstIPI, codEnq, vlBCIPI, aliqIPI,
            vlIPI, cstPIS, vlBCPIS, aliqPIS, quantBCPIS, vlPIS,
            cstCOFINS, vlBCCOFINS, aliqCOFINS, quantBCCOFINS, vlCOFINS,
            codCTA,
          ]),
          ordem: ordem++,
        })

        // Aggregate CFOP resumo for saída
        if (cfop) {
          const existing = cfopResumos.find(r => r.cfop === cfop && r.cst === (cst || ''))
          if (existing) {
            existing.baseIcms += Number(item.baseIcms)
            existing.valorIcms += Number(item.valorIcms)
            existing.valorIpi += Number(item.valorIpi)
            existing.valorPis += Number(item.valorPis)
            existing.valorCofins += Number(item.valorCofins)
            existing.valorTotal += Number(item.valorTotal)
          } else {
            cfopResumos.push({
              cfop,
              cst: cst || '',
              baseIcms: Number(item.baseIcms),
              valorIcms: Number(item.valorIcms),
              valorIpi: Number(item.valorIpi),
              valorPis: Number(item.valorPis),
              valorCofins: Number(item.valorCofins),
              valorTotal: Number(item.valorTotal),
            })
          }
        }

        itemNum++
      }
    }

    // |C190| - Resumo de operações por CFOP
    // Group by CFOP
    const cfopMap = new Map<string, CfopResumo>()
    for (const r of cfopResumos) {
      const key = `${r.cfop}_${r.cst}`
      const existing = cfopMap.get(key)
      if (existing) {
        existing.baseIcms += r.baseIcms
        existing.valorIcms += r.valorIcms
        existing.valorIpi += r.valorIpi
        existing.valorPis += r.valorPis
        existing.valorCofins += r.valorCofins
        existing.valorTotal += r.valorTotal
      } else {
        cfopMap.set(key, { ...r })
      }
    }

    for (const [, resumo] of cfopMap) {
      lines.push({
        registro: 'C190',
        bloco: 'C',
        linha: buildLine([
          'C190',
          resumo.cfop,                     // CFOP
          resumo.cst,                      // CST_ICMS
          formatNumber(resumo.baseIcms),   // VL_BC_ICMS
          formatNumber(resumo.valorIcms),  // VL_ICMS
          '',                              // VL_BC_ICMS_ST
          '',                              // VL_ICMS_ST
          formatNumber(resumo.valorIpi),   // VL_IPI
          formatNumber(resumo.valorPis),   // VL_PIS
          formatNumber(resumo.valorCofins), // VL_COFINS
        ]),
        ordem: ordem++,
      })
    }
  }

  // |C995| - Encerramento do Bloco C
  const blockCCount = lines.filter(l => l.bloco === 'C').length + 1 // +1 for C995 itself
  lines.push({
    registro: 'C995',
    bloco: 'C',
    linha: buildLine(['C995', String(blockCCount)]),
    ordem: ordem++,
  })

  return { lines, cfopResumos }
}

/**
 * BLOCO D - Documentos Fiscais II (Serviços - NFS-e)
 */
async function generateBlocoD(
  config: SpedGeneratorConfig,
  dataInicio: Date,
  dataFim: Date
): Promise<SpedLine[]> {
  const lines: SpedLine[] = []
  let ordem = 0

  // Check for NFS-e in the period
  const nfseCount = await db.nfseServico.count({
    where: {
      officeId: config.officeId,
      deleted: false,
      dataEmissao: { gte: dataInicio, lte: dataFim },
      status: 'EMITIDA',
    },
  })

  // |D001| - Abertura do Bloco D
  lines.push({
    registro: 'D001',
    bloco: 'D',
    linha: buildLine(['D001', nfseCount > 0 ? '0' : '1']),
    ordem: ordem++,
  })

  if (nfseCount > 0) {
    const nfses = await db.nfseServico.findMany({
      where: {
        officeId: config.officeId,
        deleted: false,
        dataEmissao: { gte: dataInicio, lte: dataFim },
        status: 'EMITIDA',
      },
      orderBy: { dataEmissao: 'asc' },
    })

    for (const nfse of nfses) {
      // |D500| - NFS-e
      const indOper = '1' // Saída (prestação de serviço)
      const indEmit = '0' // Emissão própria
      const codPart = nfse.clienteCpfCnpj ? `CLI${onlyDigits(nfse.clienteCpfCnpj).substring(0, 8)}` : ''
      const codMod = '' // Modelo do documento fiscal
      const codSit = '00' // Documento regular
      const serie = ''
      const numDoc = nfse.numero
      const dtDoc = formatDate(nfse.dataEmissao)
      const dtAP = formatDate(nfse.dataEmissao)
      const vlDoc = formatNumber(nfse.valorTotal)
      const vlDesc = ''
      const vlServ = formatNumber(nfse.valorServicos)
      const vlServNT = formatNumber(nfse.valorDeducoes)
      const vlTrib = formatNumber(Number(nfse.valorIssqn) + Number(nfse.valorPis) + Number(nfse.valorCofins) + Number(nfse.valorIr) + Number(nfse.valorCsll) + Number(nfse.valorInss))
      const vlBCISSQN = formatNumber(nfse.baseCalculo)
      const vlISSQN = formatNumber(nfse.valorIssqn)
      const vlBCIR = ''
      const vlIR = formatNumber(nfse.valorIr)
      const vlBCCSLL = ''
      const vlCSLL = formatNumber(nfse.valorCsll)
      const vlBCPIS = ''
      const vlPIS = formatNumber(nfse.valorPis)
      const vlBCCOFINS = ''
      const vlCOFINS = formatNumber(nfse.valorCofins)

      lines.push({
        registro: 'D500',
        bloco: 'D',
        linha: buildLine([
          'D500', indOper, indEmit, codPart, codMod, codSit,
          serie, numDoc, dtDoc, dtAP, vlDoc, vlDesc,
          vlServ, vlServNT, vlTrib, vlBCISSQN, vlISSQN,
          vlBCIR, vlIR, vlBCCSLL, vlCSLL, vlBCPIS, vlPIS,
          vlBCCOFINS, vlCOFINS,
        ]),
        ordem: ordem++,
      })
    }
  }

  // |D990| - Encerramento do Bloco D
  const blockDCount = lines.filter(l => l.bloco === 'D').length + 1
  lines.push({
    registro: 'D990',
    bloco: 'D',
    linha: buildLine(['D990', String(blockDCount)]),
    ordem: ordem++,
  })

  return lines
}

/**
 * BLOCO E - Apuração do ICMS e do IPI
 */
async function generateBlocoE(
  config: SpedGeneratorConfig,
  dataInicio: Date,
  dataFim: Date,
  cfopResumos: CfopResumo[]
): Promise<SpedLine[]> {
  const lines: SpedLine[] = []
  let ordem = 0

  // |E001| - Abertura do Bloco E
  lines.push({
    registro: 'E001',
    bloco: 'E',
    linha: buildLine(['E001', '0']), // Com dados
    ordem: ordem++,
  })

  // |E100| - Período da apuração do ICMS
  lines.push({
    registro: 'E100',
    bloco: 'E',
    linha: buildLine(['E100', formatDate(dataInicio), formatDate(dataFim)]),
    ordem: ordem++,
  })

  // |E110| - Apuração do ICMS - Operações próprias
  // Calculate totals from CFOP resumos
  let totalBaseIcms = 0
  let totalValorIcms = 0
  let totalValorIpi = 0
  let totalValorPis = 0
  let totalValorCofins = 0

  for (const r of cfopResumos) {
    totalBaseIcms += r.baseIcms
    totalValorIcms += r.valorIcms
    totalValorIpi += r.valorIpi
    totalValorPis += r.valorPis
    totalValorCofins += r.valorCofins
  }

  // Get financial entries for ICMS debits/credits
  const entradas = cfopResumos.filter(r => r.cfop.startsWith('1') || r.cfop.startsWith('2') || r.cfop.startsWith('3'))
  const saidas = cfopResumos.filter(r => r.cfop.startsWith('5') || r.cfop.startsWith('6') || r.cfop.startsWith('7'))

  const vlOdeb = saidas.reduce((acc, r) => acc + r.valorIcms, 0) // Débitos de ICMS (saídas)
  const vlOcre = entradas.reduce((acc, r) => acc + r.valorIcms, 0) // Créditos de ICMS (entradas)
  const vlSLd = vlOdeb - vlOcre // Saldo devedor
  const vlSldAnt = '' // Saldo credor do período anterior
  const vlSldCred = vlOcre > vlOdeb ? (vlOcre - vlOdeb) : 0 // Saldo credor a transportar

  lines.push({
    registro: 'E110',
    bloco: 'E',
    linha: buildLine([
      'E110',
      formatNumber(vlOdeb),        // VL_ODEB - Total de débitos
      '',                           // VL_DED - Deduções
      '',                           // VL_ICMS_ST_REST - ICMS ST a restituir
      formatNumber(vlOcre),        // VL_CRED - Total de créditos
      '',                           // VL_ICMS_ST_COMPL - ICMS ST complementar
      '',                           // VL_ICMS_ST_REST_COMPL - ICMS ST restituir complementar
      '',                           // VL_ICMS_ST_COMPL_COMPL - ICMS ST complementar complementar
      '',                           // VL_SLD_ANT - Saldo credor anterior
      vlSLd > 0 ? formatNumber(vlSLd) : '', // VL_SLD_APUR - Saldo devedor apurado
      '',                           // VL_DEDUC - Deduções do saldo devedor
      vlSldCred > 0 ? formatNumber(vlSldCred) : '', // VL_ICMS_RECOLHER - ICMS a recolher
      vlSldCred > 0 ? formatNumber(vlSldCred) : '', // VL_SLD_CRED_TRANSPORTAR - Saldo credor a transportar
      '',                           // VL_DEB_ESP - Débitos especiais
    ]),
    ordem: ordem++,
  })

  // |E200| - Período de apuração do ICMS - Substituição Tributária
  lines.push({
    registro: 'E200',
    bloco: 'E',
    linha: buildLine(['E200', formatDate(dataInicio), formatDate(dataFim)]),
    ordem: ordem++,
  })

  // |E500| - Período de apuração do IPI
  lines.push({
    registro: 'E500',
    bloco: 'E',
    linha: buildLine(['E500', formatDate(dataInicio), formatDate(dataFim)]),
    ordem: ordem++,
  })

  // |E510| - Apuração do IPI
  const cfopIpiMap = new Map<string, { cfop: string; cstIpi: string; valorIpi: number; baseCalculo: number }>()

  for (const r of cfopResumos) {
    if (r.valorIpi > 0) {
      const key = `${r.cfop}_50` // CST IPI 50 = Saída tributada
      const existing = cfopIpiMap.get(key)
      if (existing) {
        existing.valorIpi += r.valorIpi
        existing.baseCalculo += r.baseIcms
      } else {
        cfopIpiMap.set(key, {
          cfop: r.cfop,
          cstIpi: '50',
          valorIpi: r.valorIpi,
          baseCalculo: r.baseIcms,
        })
      }
    }
  }

  for (const [, ipiResumo] of cfopIpiMap) {
    lines.push({
      registro: 'E510',
      bloco: 'E',
      linha: buildLine([
        'E510',
        ipiResumo.cfop,                    // CFOP
        ipiResumo.cstIpi,                  // CST_IPI
        formatNumber(ipiResumo.valorIpi),  // VL_CONT_IPI - Valor contábil
        formatNumber(ipiResumo.baseCalculo), // VL_BC_IPI - Base de cálculo
        formatNumber(ipiResumo.valorIpi),  // VL_IPI - Valor do IPI
      ]),
      ordem: ordem++,
    })
  }

  // |E990| - Encerramento do Bloco E
  const blockECount = lines.filter(l => l.bloco === 'E').length + 1
  lines.push({
    registro: 'E990',
    bloco: 'E',
    linha: buildLine(['E990', String(blockECount)]),
    ordem: ordem++,
  })

  return lines
}

/**
 * BLOCO H - Inventário
 */
async function generateBlocoH(
  config: SpedGeneratorConfig,
  dataFim: Date
): Promise<SpedLine[]> {
  const lines: SpedLine[] = []
  let ordem = 0

  // |H001| - Abertura do Bloco H
  lines.push({
    registro: 'H001',
    bloco: 'H',
    linha: buildLine(['H001', '0']), // Com dados
    ordem: ordem++,
  })

  // Get all parts with stock
  const parts = await db.part.findMany({
    where: {
      officeId: config.officeId,
      deleted: false,
      quantity: { gt: 0 },
    },
    orderBy: { sku: 'asc' },
  })

  // Calculate total inventory value
  let totalInventario = 0
  for (const p of parts) {
    totalInventario += Number(p.quantity) * Number(p.costPrice)
  }

  // |H005| - Totais do inventário
  const indEst = '0' // 0=Estoque próprio
  lines.push({
    registro: 'H005',
    bloco: 'H',
    linha: buildLine(['H005', formatDate(dataFim), formatNumber(totalInventario), indEst]),
    ordem: ordem++,
  })

  // |H010| - Inventário (detalhe)
  for (const p of parts) {
    const vlItem = Number(p.quantity) * Number(p.costPrice)
    lines.push({
      registro: 'H010',
      bloco: 'H',
      linha: buildLine([
        'H010',
        p.sku,                          // COD_ITEM
        '',                             // UNID
        p.unit || 'UN',                 // QTD
        formatNumber(p.quantity, 3),    // VL_UNIT
        formatNumber(p.costPrice),      // VL_ITEM
        '',                             // IND_PROP (0=próprio)
        '',                             // COD_PART
        '',                             // TXT_COMPL
        '',                             // COD_CTA
        '',                             // VL_ITEM_IR
      ]),
      ordem: ordem++,
    })
  }

  // |H990| - Encerramento do Bloco H
  const blockHCount = lines.filter(l => l.bloco === 'H').length + 1
  lines.push({
    registro: 'H990',
    bloco: 'H',
    linha: buildLine(['H990', String(blockHCount)]),
    ordem: ordem++,
  })

  return lines
}

/**
 * BLOCO 1 - Outras Informações
 */
async function generateBloco1(): Promise<SpedLine[]> {
  const lines: SpedLine[] = []
  let ordem = 0

  // |1001| - Abertura do Bloco 1
  lines.push({
    registro: '1001',
    bloco: '1',
    linha: buildLine(['1001', '1']), // Sem dados
    ordem: ordem++,
  })

  // |1990| - Encerramento do Bloco 1
  const block1Count = lines.filter(l => l.bloco === '1').length + 1
  lines.push({
    registro: '1990',
    bloco: '1',
    linha: buildLine(['1990', String(block1Count)]),
    ordem: ordem++,
  })

  return lines
}

/**
 * BLOCO 9 - Controle e Encerramento
 */
async function generateBloco9(allLines: SpedLine[]): Promise<SpedLine[]> {
  const lines: SpedLine[] = []
  let ordem = 0

  // |9001| - Abertura do Bloco 9
  lines.push({
    registro: '9001',
    bloco: '9',
    linha: buildLine(['9001', '0']), // Com dados
    ordem: ordem++,
  })

  // |9990| - Encerramento do Bloco 9
  const block9Count = 3 // 9001 + 9990 + 9999
  lines.push({
    registro: '9990',
    bloco: '9',
    linha: buildLine(['9990', String(block9Count)]),
    ordem: ordem++,
  })

  // |9999| - Encerramento do arquivo
  const totalLinhas = allLines.length + lines.length + 1 // +1 for 9999 itself
  lines.push({
    registro: '9999',
    bloco: '9',
    linha: buildLine(['9999', String(totalLinhas)]),
    ordem: ordem++,
  })

  return lines
}

// ============================================
// Main generator function
// ============================================

/**
 * Generate SPED Fiscal (EFD ICMS/IPI) file content
 *
 * @param config Configuration including officeId, competencia, and optional parameters
 * @returns Generation result with file content, line count, and per-block counts
 */
export async function generateSpedFiscal(config: SpedGeneratorConfig): Promise<SpedGenerationResult> {
  const errors: string[] = []

  try {
    // Validate competencia format
    if (!/^\d{6}$/.test(config.competencia)) {
      return {
        success: false,
        conteudo: '',
        totalLinhas: 0,
        totalRegistros: {},
        errors: ['Competência inválida. Use o formato AAAAMM (ex: 202401).'],
      }
    }

    // Parse competencia to date range
    const { dataInicio, dataFim } = parseCompetencia(config.competencia)
    const effectiveDataInicio = config.dataInicio || dataInicio
    const effectiveDataFim = config.dataFim || dataFim

    // Verify office exists
    const office = await db.office.findUnique({
      where: { id: config.officeId },
    })

    if (!office) {
      return {
        success: false,
        conteudo: '',
        totalLinhas: 0,
        totalRegistros: {},
        errors: ['Escritório não encontrado.'],
      }
    }

    // Generate all blocks
    const bloco0Lines = await generateBloco0(config, effectiveDataInicio, effectiveDataFim)
    const { lines: blocoCLines, cfopResumos } = await generateBlocoC(config, effectiveDataInicio, effectiveDataFim)
    const blocoDLines = await generateBlocoD(config, effectiveDataInicio, effectiveDataFim)
    const blocoELines = await generateBlocoE(config, effectiveDataInicio, effectiveDataFim, cfopResumos)
    const blocoHLines = await generateBlocoH(config, effectiveDataFim)
    const bloco1Lines = await generateBloco1()

    // Combine all lines before Block 9 (needed for total count)
    const allLinesBefore9 = [
      ...bloco0Lines,
      ...blocoCLines,
      ...blocoDLines,
      ...blocoELines,
      ...blocoHLines,
      ...bloco1Lines,
    ]

    const bloco9Lines = await generateBloco9(allLinesBefore9)

    // Combine all lines
    const allLines = [
      ...allLinesBefore9,
      ...bloco9Lines,
    ]

    // Build file content
    const conteudo = allLines.map(l => l.linha).join('\n')

    // Count per block
    const totalRegistros: Record<string, number> = {}
    for (const line of allLines) {
      totalRegistros[line.bloco] = (totalRegistros[line.bloco] || 0) + 1
    }

    return {
      success: true,
      conteudo,
      totalLinhas: allLines.length,
      totalRegistros,
      errors: errors.length > 0 ? errors : undefined,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao gerar SPED Fiscal'
    console.error('Erro na geração do SPED Fiscal:', error)
    return {
      success: false,
      conteudo: '',
      totalLinhas: 0,
      totalRegistros: {},
      errors: [errorMessage],
    }
  }
}

/**
 * Generate preview/summary of SPED Fiscal data without generating the full file
 */
export async function generateSpedFiscalPreview(
  config: SpedGeneratorConfig
): Promise<{
  success: boolean
  resumo: {
    totalNfeEntrada: number
    totalNfeSaida: number
    totalNfse: number
    totalParticipantes: number
    totalItens: number
    totalInventario: number
    valorInventario: number
    cfopResumo: Array<{ cfop: string; baseIcms: number; valorIcms: number; valorIpi: number }>
  } | null
  errors?: string[]
}> {
  try {
    // Validate competencia
    if (!/^\d{6}$/.test(config.competencia)) {
      return {
        success: false,
        resumo: null,
        errors: ['Competência inválida. Use o formato AAAAMM (ex: 202401).'],
      }
    }

    const { dataInicio, dataFim } = parseCompetencia(config.competencia)
    const effectiveDataInicio = config.dataInicio || dataInicio
    const effectiveDataFim = config.dataFim || dataFim

    // Count NF-e de entrada
    const totalNfeEntrada = await db.invoice.count({
      where: {
        officeId: config.officeId,
        deleted: false,
        dataEmissao: { gte: effectiveDataInicio, lte: effectiveDataFim },
      },
    })

    // Count NF-e de saída
    const totalNfeSaida = await db.clientInvoice.count({
      where: {
        officeId: config.officeId,
        deleted: false,
        dataEmissao: { gte: effectiveDataInicio, lte: effectiveDataFim },
        status: 'EMITIDA',
      },
    })

    // Count NFS-e
    const totalNfse = await db.nfseServico.count({
      where: {
        officeId: config.officeId,
        deleted: false,
        dataEmissao: { gte: effectiveDataInicio, lte: effectiveDataFim },
        status: 'EMITIDA',
      },
    })

    // Count participants (suppliers + clients)
    const totalFornecedores = await db.supplier.count({
      where: { officeId: config.officeId, deleted: false },
    })
    const totalClientes = await db.client.count({
      where: { officeId: config.officeId, deleted: false },
    })
    const totalParticipantes = totalFornecedores + totalClientes

    // Count items (parts)
    const totalItens = await db.part.count({
      where: { officeId: config.officeId, deleted: false },
    })

    // Count inventory items
    const inventoryParts = await db.part.findMany({
      where: {
        officeId: config.officeId,
        deleted: false,
        quantity: { gt: 0 },
      },
      select: { quantity: true, costPrice: true },
    })

    const totalInventario = inventoryParts.length
    const valorInventario = inventoryParts.reduce((acc, p) => acc + (Number(p.quantity) * Number(p.costPrice)), 0)

    // CFOP resumo
    const invoices = await db.invoice.findMany({
      where: {
        officeId: config.officeId,
        deleted: false,
        dataEmissao: { gte: effectiveDataInicio, lte: effectiveDataFim },
      },
      include: {
        items: {
          where: { deleted: false },
          select: { cfop: true, baseIcms: true, valorIcms: true, valorIpi: true },
        },
      },
    })

    const cfopMap = new Map<string, { cfop: string; baseIcms: number; valorIcms: number; valorIpi: number }>()
    for (const inv of invoices) {
      for (const item of inv.items) {
        if (item.cfop) {
          const existing = cfopMap.get(item.cfop)
          if (existing) {
            existing.baseIcms += Number(item.baseIcms)
            existing.valorIcms += Number(item.valorIcms)
            existing.valorIpi += Number(item.valorIpi)
          } else {
            cfopMap.set(item.cfop, {
              cfop: item.cfop,
              baseIcms: Number(item.baseIcms),
              valorIcms: Number(item.valorIcms),
              valorIpi: Number(item.valorIpi),
            })
          }
        }
      }
    }

    // Also include client invoice items
    const clientInvoices = await db.clientInvoice.findMany({
      where: {
        officeId: config.officeId,
        deleted: false,
        dataEmissao: { gte: effectiveDataInicio, lte: effectiveDataFim },
        status: 'EMITIDA',
      },
      include: {
        items: {
          where: { deleted: false },
          select: { cfop: true, baseIcms: true, valorIcms: true, valorIpi: true },
        },
      },
    })

    for (const cinv of clientInvoices) {
      for (const item of cinv.items) {
        if (item.cfop) {
          const existing = cfopMap.get(item.cfop)
          if (existing) {
            existing.baseIcms += Number(item.baseIcms)
            existing.valorIcms += Number(item.valorIcms)
            existing.valorIpi += Number(item.valorIpi)
          } else {
            cfopMap.set(item.cfop, {
              cfop: item.cfop,
              baseIcms: Number(item.baseIcms),
              valorIcms: Number(item.valorIcms),
              valorIpi: Number(item.valorIpi),
            })
          }
        }
      }
    }

    const cfopResumo = Array.from(cfopMap.values()).sort((a, b) => a.cfop.localeCompare(b.cfop))

    return {
      success: true,
      resumo: {
        totalNfeEntrada,
        totalNfeSaida,
        totalNfse,
        totalParticipantes,
        totalItens,
        totalInventario,
        valorInventario,
        cfopResumo,
      },
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido ao gerar preview do SPED Fiscal'
    console.error('Erro no preview SPED Fiscal:', error)
    return {
      success: false,
      resumo: null,
      errors: [errorMessage],
    }
  }
}
