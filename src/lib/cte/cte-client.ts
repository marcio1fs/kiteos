/**
 * Cliente CT-e - Comunicação com webservices SEFAZ para CT-e
 * Implementa consulta protocolo e download de CT-e
 * Conforme leiaute CT-e 4.00 (NT 2018.005 e atualizações)
 */

import { getUfFromChave, type Ambiente } from '@/lib/sefaz/endpoints'
import { applyRateLimit } from '@/lib/sefaz/rate-limiter'

// AUD-H04 FIX: Import escapeXml from NF-e soap builder for SOAP injection protection
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Configurações
const TIMEOUT_MS = 15000
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

export interface CteClientConfig {
  ambiente: Ambiente
  uf?: string
  cnpjCpf: string
  timeout?: number
  maxRetries?: number
}

export interface CteConsultaResponse {
  success: boolean
  data?: CteConsultaResult
  error?: string
  friendlyError?: string
  tempoResposta?: number
  tentativas: number
}

export interface CteDownloadResponse {
  success: boolean
  data?: CteDownloadResult
  error?: string
  friendlyError?: string
  tempoResposta?: number
  tentativas: number
}

export interface CteConsultaResult {
  cStat: string
  xMotivo: string
  protocolo: string | null
  dhRecbto: string | null
  chCTe: string
  cUF: string | null
  cteStatus: 'AUTORIZADO' | 'CANCELADO' | 'DENEGADO' | 'INUTILIZADO' | 'NAO_ENCONTRADO' | 'ERRO'
  emitenteCnpj: string | null
}

export interface CteDownloadResult {
  cStat: string
  xMotivo: string
  chCTe: string
  xmlContent: string | null
}

// =============================================
// CT-e Webservice Endpoints
// =============================================

interface CteEndpoint {
  consulta: string
  download: string
}

/**
 * Endpoints de homologação CT-e por UF
 * CT-e usa webservices distintos dos de NF-e
 */
const HOMOLOGACAO_CTE_ENDPOINTS: Record<string, CteEndpoint> = {
  AC: {
    consulta: 'https://homologacao.sefaznet.ac.gov.br/cteweb/services/CteConsultaProtocolo',
    download: 'https://homologacao.sefaznet.ac.gov.br/cteweb/services/CteDownload',
  },
  AL: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  AP: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  AM: {
    consulta: 'https://homologacao.sefaz.am.gov.br/services2/services/CteConsultaProtocolo4',
    download: 'https://homologacao.sefaz.am.gov.br/services2/services/CteDownload4',
  },
  BA: {
    consulta: 'https://hcte.sefaz.ba.gov.br/webservices/CteConsultaProtocolo4/CteConsultaProtocolo4.asmx',
    download: 'https://hcte.sefaz.ba.gov.br/webservices/CteDownload4/CteDownload4.asmx',
  },
  CE: {
    consulta: 'https://hcte.sefaz.ce.gov.br/cte4/services/CteConsultaProtocolo4',
    download: 'https://hcte.sefaz.ce.gov.br/cte4/services/CteDownload4',
  },
  DF: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  ES: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  GO: {
    consulta: 'https://homolog.sefaz.go.gov.br/cte/services/v4/CteConsultaProtocolo4',
    download: 'https://homolog.sefaz.go.gov.br/cte/services/v4/CteDownload4',
  },
  MA: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  MG: {
    consulta: 'https://hcte.fazenda.mg.gov.br/cte2/services/CteConsultaProtocolo4',
    download: 'https://hcte.fazenda.mg.gov.br/cte2/services/CteDownload4',
  },
  MS: {
    consulta: 'https://homologacao.cte.ms.gov.br/ws/CteConsultaProtocolo4',
    download: 'https://homologacao.cte.ms.gov.br/ws/CteDownload4',
  },
  MT: {
    consulta: 'https://homologacao.sefaz.mt.gov.br/cteweb/services/CteConsultaProtocolo4',
    download: 'https://homologacao.sefaz.mt.gov.br/cteweb/services/CteDownload4',
  },
  PA: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  PB: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  PE: {
    consulta: 'https://ctehomolog.sefaz.pe.gov.br/cte-service/services/CteConsultaProtocolo4',
    download: 'https://ctehomolog.sefaz.pe.gov.br/cte-service/services/CteDownload4',
  },
  PI: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  PR: {
    consulta: 'https://homologacao.cte.sefa.pr.gov.br/cte/CteConsultaProtocolo4',
    download: 'https://homologacao.cte.sefa.pr.gov.br/cte/CteDownload4',
  },
  RJ: {
    consulta: 'https://homologacao.cte.fazenda.rj.gov.br/ws/CteConsultaProtocolo4/CteConsultaProtocolo4.asmx',
    download: 'https://homologacao.cte.fazenda.rj.gov.br/ws/CteDownload4/CteDownload4.asmx',
  },
  RN: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  RO: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  RR: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  RS: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  SC: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  SE: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  SP: {
    consulta: 'https://homologacao.cte.fazenda.sp.gov.br/ws/CteConsultaProtocolo4.asmx',
    download: 'https://homologacao.cte.fazenda.sp.gov.br/ws/CteDownload4.asmx',
  },
  TO: {
    consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
}

/**
 * Endpoints de produção CT-e por UF
 */
const PRODUCAO_CTE_ENDPOINTS: Record<string, CteEndpoint> = {
  AC: {
    consulta: 'https://www.sefaznet.ac.gov.br/cteweb/services/CteConsultaProtocolo',
    download: 'https://www.sefaznet.ac.gov.br/cteweb/services/CteDownload',
  },
  AL: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  AP: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  AM: {
    consulta: 'https://sistemas.sefaz.am.gov.br/services2/services/CteConsultaProtocolo4',
    download: 'https://sistemas.sefaz.am.gov.br/services2/services/CteDownload4',
  },
  BA: {
    consulta: 'https://cte.sefaz.ba.gov.br/webservices/CteConsultaProtocolo4/CteConsultaProtocolo4.asmx',
    download: 'https://cte.sefaz.ba.gov.br/webservices/CteDownload4/CteDownload4.asmx',
  },
  CE: {
    consulta: 'https://cte.sefaz.ce.gov.br/cte4/services/CteConsultaProtocolo4',
    download: 'https://cte.sefaz.ce.gov.br/cte4/services/CteDownload4',
  },
  DF: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  ES: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  GO: {
    consulta: 'https://cte.sefaz.go.gov.br/cte/services/v4/CteConsultaProtocolo4',
    download: 'https://cte.sefaz.go.gov.br/cte/services/v4/CteDownload4',
  },
  MA: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  MG: {
    consulta: 'https://cte.fazenda.mg.gov.br/cte2/services/CteConsultaProtocolo4',
    download: 'https://cte.fazenda.mg.gov.br/cte2/services/CteDownload4',
  },
  MS: {
    consulta: 'https://cte.ms.gov.br/ws/CteConsultaProtocolo4',
    download: 'https://cte.ms.gov.br/ws/CteDownload4',
  },
  MT: {
    consulta: 'https://sefaz.mt.gov.br/cteweb/services/CteConsultaProtocolo4',
    download: 'https://sefaz.mt.gov.br/cteweb/services/CteDownload4',
  },
  PA: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  PB: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  PE: {
    consulta: 'https://cte.sefaz.pe.gov.br/cte-service/services/CteConsultaProtocolo4',
    download: 'https://cte.sefaz.pe.gov.br/cte-service/services/CteDownload4',
  },
  PI: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  PR: {
    consulta: 'https://cte.sefa.pr.gov.br/cte/CteConsultaProtocolo4',
    download: 'https://cte.sefa.pr.gov.br/cte/CteDownload4',
  },
  RJ: {
    consulta: 'https://cte.fazenda.rj.gov.br/ws/CteConsultaProtocolo4/CteConsultaProtocolo4.asmx',
    download: 'https://cte.fazenda.rj.gov.br/ws/CteDownload4/CteDownload4.asmx',
  },
  RN: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  RO: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  RR: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  RS: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  SC: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  SE: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
  SP: {
    consulta: 'https://cte.fazenda.sp.gov.br/ws/CteConsultaProtocolo4.asmx',
    download: 'https://cte.fazenda.sp.gov.br/ws/CteDownload4.asmx',
  },
  TO: {
    consulta: 'https://cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
    download: 'https://cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
  },
}

/**
 * Retorna os endpoints CT-e para uma UF e ambiente
 */
function getCteEndpoint(uf: string, ambiente: Ambiente): CteEndpoint {
  const normalizedUf = uf.toUpperCase().trim()
  const endpoints = ambiente === 'PRODUCAO' ? PRODUCAO_CTE_ENDPOINTS : HOMOLOGACAO_CTE_ENDPOINTS
  const endpoint = endpoints[normalizedUf]
  if (!endpoint) {
    return endpoints['RS'] || {
      consulta: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteConsulta/CteConsulta4.asmx',
      download: 'https://homologacao.cte.sefaz.rs.gov.br/ws/CteDownload/CteDownload4.asmx',
    }
  }
  return endpoint
}

/**
 * Retorna o código numérico da UF
 */
function getUfCode(uf: string): string {
  const codes: Record<string, string> = {
    AC: '12', AL: '27', AP: '16', AM: '13', BA: '29',
    CE: '23', DF: '53', ES: '32', GO: '52', MA: '21',
    MG: '31', MS: '50', MT: '51', PA: '15', PB: '25',
    PE: '26', PI: '22', PR: '41', RJ: '33', RN: '24',
    RO: '11', RR: '14', RS: '43', SC: '42', SE: '28',
    SP: '35', TO: '17',
  }
  // AUD-H04 FIX: Throw on invalid UF instead of silently defaulting to BA(29)
  const code = codes[uf.toUpperCase()]
  if (!code) throw new Error(`UF inválida para CT-e: ${uf}`)
  return code
}

// =============================================
// SOAP Envelope Builders
// =============================================

/**
 * SOAP envelope para Consulta Protocolo CT-e (cteConsultaCT)
 * Serviço: CteConsultaProtocolo4
 * Namespace: http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaProtocolo4
 */
function buildCteConsultaProtocoloEnvelope(
  chave: string,
  ambiente: Ambiente,
  uf: string,
  _cnpjCpf: string
): string {
  const tpAmb = ambiente === 'PRODUCAO' ? '1' : '2'

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap12:Header>
    <cteCabecMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaProtocolo4">
      <cUF>${getUfCode(uf)}</cUF>
      <versaoDados>4.00</versaoDados>
    </cteCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaProtocolo4">
      <consSitCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
        <tpAmb>${tpAmb}</tpAmb>
        <xServ>CONSULTAR</xServ>
        <chCTe>${escapeXml(chave)}</chCTe>
      </consSitCTe>
    </cteDadosMsg>
  </soap12:Body>
</soap12:Envelope>`
}

/**
 * SOAP envelope para Download CT-e (cteDownloadCT)
 * Serviço: CteDownload4
 * Namespace: http://www.portalfiscal.inf.br/cte/wsdl/CteDownload4
 */
function buildCteDownloadEnvelope(
  chave: string,
  ambiente: Ambiente,
  uf: string,
  cnpjCpf: string
): string {
  const tpAmb = ambiente === 'PRODUCAO' ? '1' : '2'

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap12:Header>
    <cteCabecMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CteDownload4">
      <cUF>${getUfCode(uf)}</cUF>
      <versaoDados>4.00</versaoDados>
    </cteCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <cteDadosMsg xmlns="http://www.portalfiscal.inf.br/cte/wsdl/CteDownload4">
      <downloadCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
        <tpAmb>${tpAmb}</tpAmb>
        <xServ>DOWNLOAD CTE</xServ>
        <CNPJ>${escapeXml(cnpjCpf)}</CNPJ>
        <chCTe>${escapeXml(chave)}</chCTe>
      </downloadCTe>
    </cteDadosMsg>
  </soap12:Body>
</soap12:Envelope>`
}

// =============================================
// Response Parsers
// =============================================

/**
 * Extrai valor de tag XML usando regex
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Extrai bloco XML
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
 * Mapeia cStat para status interno do CT-e
 * Códigos de status específicos do CT-e
 */
function mapCStatToCteStatus(cStat: string): CteConsultaResult['cteStatus'] {
  const authorized = ['100', '150'] // CT-e Autorizado o uso / CT-e Autorizado o uso
  const cancelled = ['101', '151'] // Cancelamento de CT-e / Cancelamento de CT-e fora de prazo
  const denied = ['110', '205', '301', '302'] // Uso Denegado
  const unused = ['102', '217'] // Inutilização

  if (authorized.includes(cStat)) return 'AUTORIZADO'
  if (cancelled.includes(cStat)) return 'CANCELADO'
  if (denied.includes(cStat)) return 'DENEGADO'
  if (unused.includes(cStat)) return 'INUTILIZADO'
  if (['516', '517', '518', '563', '564', '565', '567', '568', '578', '579', '580'].includes(cStat)) return 'NAO_ENCONTRADO'

  return 'ERRO'
}

/**
 * Parse da resposta de Consulta Protocolo CT-e
 */
function parseCteConsultaResponse(soapResponse: string): CteConsultaResult {
  const body = extractBlock(soapResponse, 'soap:Body') || extractBlock(soapResponse, 'Body') || soapResponse

  const retConsSitCTe = extractBlock(body, 'retConsSitCTe') || body

  const cStat = extractValue(retConsSitCTe, 'cStat') || ''
  const xMotivo = extractValue(retConsSitCTe, 'xMotivo') || 'Resposta não identificada'
  const chCTe = extractValue(retConsSitCTe, 'chCTe') || ''
  const cUF = extractValue(retConsSitCTe, 'cUF')

  let protocolo: string | null = null
  let dhRecbto: string | null = null
  let emitenteCnpj: string | null = null

  const protCTeBlock = extractBlock(retConsSitCTe, 'protCTe')
  if (protCTeBlock) {
    protocolo = extractValue(protCTeBlock, 'nProt')
    dhRecbto = extractValue(protCTeBlock, 'dhRecbto')

    const infProtBlock = extractBlock(protCTeBlock, 'infProt')
    if (infProtBlock) {
      const emitCnpj = extractValue(infProtBlock, 'CNPJ')
      if (emitCnpj) emitenteCnpj = emitCnpj
    }
  }

  return {
    cStat,
    xMotivo,
    protocolo,
    dhRecbto,
    chCTe,
    cUF,
    cteStatus: mapCStatToCteStatus(cStat),
    emitenteCnpj,
  }
}

/**
 * Parse da resposta de Download CT-e
 */
function parseCteDownloadResponse(soapResponse: string): CteDownloadResult {
  const body = extractBlock(soapResponse, 'soap:Body') || extractBlock(soapResponse, 'Body') || soapResponse

  const retDownloadCTe = extractBlock(body, 'retDownloadCTe') || body

  const cStat = extractValue(retDownloadCTe, 'cStat') || ''
  const xMotivo = extractValue(retDownloadCTe, 'xMotivo') || 'Resposta não identificada'
  const chCTe = extractValue(retDownloadCTe, 'chCTe') || ''

  let xmlContent: string | null = null
  const procCTeBlock = extractBlock(retDownloadCTe, 'procCTe')
  if (procCTeBlock) {
    xmlContent = `<?xml version="1.0" encoding="UTF-8"?><cteProc xmlns="http://www.portalfiscal.inf.br/cte">${procCTeBlock}</cteProc>`
  }

  if (!xmlContent) {
    const cteBlock = extractBlock(retDownloadCTe, 'CTe')
    if (cteBlock) {
      xmlContent = `<?xml version="1.0" encoding="UTF-8"?><CTe xmlns="http://www.portalfiscal.inf.br/cte">${cteBlock}</CTe>`
    }
  }

  return {
    cStat,
    xMotivo,
    chCTe,
    xmlContent,
  }
}

/**
 * Mapeia código de erro SEFAZ CT-e para mensagem amigável
 */
export function mapCteErrorToFriendly(cStat: string, _xMotivo: string): string {
  const errorMap: Record<string, string> = {
    '100': 'CT-e autorizado com sucesso',
    '101': 'CT-e cancelado com sucesso',
    '102': 'Inutilização de número homologada',
    '103': 'Lote recebido com sucesso',
    '104': 'Lote processado',
    '105': 'Lote em processamento',
    '106': 'Lote não localizado',
    '107': 'Serviço em operação',
    '108': 'Serviço paralisado momentaneamente',
    '109': 'Serviço paralisado sem previsão',
    '110': 'Uso denegado',
    '150': 'Autorizado o uso do CT-e',
    '151': 'Cancelamento de CT-e homologado fora de prazo',
    '201': 'Rejeição: Número máximo de numeração a inutilizar ultrapassou o limite',
    '202': 'Rejeição: Falha no reconhecimento da autoria ou integridade do arquivo digital',
    '203': 'Rejeição: Emissor não habilitado para emissão do CT-e',
    '204': 'Rejeição: Duplicidade de CT-e',
    '205': 'Rejeição: CT-e está denegado na base de dados da SEFAZ',
    '206': 'Rejeição: CT-e já está inutilizado na base de dados da SEFAZ',
    '207': 'Rejeição: CNPJ do emitente inválido',
    '208': 'Rejeição: CNPJ do destinatário inválido',
    '209': 'Rejeição: IE do emitente inválida',
    '210': 'Rejeição: IE do destinatário inválida',
    '212': 'Rejeição: Data de emissão CT-e posterior a data de recebimento',
    '213': 'Rejeição: CNPJ-Base do Emitente difere do CNPJ-Base do Certificado Digital',
    '214': 'Rejeição: Tamanho da mensagem excedeu o limite estabelecido',
    '215': 'Rejeição: Falha no schema XML',
    '216': 'Rejeição: Chave de Acesso difere da cadastrada',
    '217': 'Rejeição: CT-e não consta na base de dados da SEFAZ',
    '218': 'Rejeição: CT-e já está cancelado na base de dados da SEFAZ',
    '220': 'Rejeição: CT-e autorizado há mais de 30 dias',
    '222': 'Rejeição: Protocolo de Autorização de Uso difere do cadastrado',
    '226': 'Rejeição: Código da UF do Emitente diverge da UF autorizadora',
    '229': 'Rejeição: IE do emitente não informada',
    '230': 'Rejeição: IE do emitente não cadastrada',
    '231': 'Rejeição: IE do emitente não vinculada ao CNPJ',
    '236': 'Rejeição: Chave de Acesso com dígito verificador inválido',
    '243': 'Rejeição: XML Mal Formado',
    '245': 'Rejeição: CNPJ Emitente não cadastrado',
    '246': 'Rejeição: CNPJ Destinatário não cadastrado',
    '247': 'Rejeição: Sigla da UF do Emitente diverge da UF autorizadora',
    '249': 'Rejeição: UF da Chave de Acesso diverge da UF autorizadora',
    '252': 'Rejeição: Ambiente informado diverge do Ambiente de recebimento',
    '253': 'Rejeição: Digito Verificador da chave de acesso composta inválido',
    '256': 'Rejeição: Um CT-e da faixa já está inutilizado na base de dados da SEFAZ',
    '263': 'Rejeição: CT-e com CPF inválido',
    '280': 'Rejeição: Certificado Transmissor inválido',
    '281': 'Rejeição: Certificado Transmissor distinto do cadastrado',
    '282': 'Rejeição: Certificado Transmissor revogado',
    '283': 'Rejeição: Certificado Transmissor data validade',
    '284': 'Rejeição: Certificado Transmissor sem CNPJ',
    '286': 'Rejeição: Certificado Transmissor erro na cadeia',
    '290': 'Rejeição: Certificado Transmissor não cadastrado',
    '291': 'Rejeição: Certificado Transmissor difere do cadastrado',
    '292': 'Rejeição: Certificado Transmissor sem CNPJ/CPF',
    '293': 'Rejeição: Certificado Transmissor não habilitado para consulta',
    '402': 'Rejeição: XML da área de dados com codificação diferente de UTF-8',
    '404': 'Rejeição: Uso de prefixo de namespace não permitido',
    '409': 'Rejeição: Campo cUF inexistente no elemento cteCabecMsg do SOAP Header',
    '410': 'Rejeição: UF informada no campo cUF não é atendida pelo WebService',
    '411': 'Rejeição: Campo versaoDados inexistente no elemento cteCabecMsg do SOAP Header',
    '413': 'Rejeição: Código de Município inválido',
    '414': 'Rejeição: CNPJ ou CPF inválido',
    '456': 'Rejeição: Código de Município diverge da UF do emitente',
    '465': 'Rejeição: CT-e com CFOP inválido para operação',
    '478': 'Rejeição: CT-e com CFOP de operação interna para UF diferente',
    '479': 'Rejeição: CT-e com CFOP de operação externa para UF igual',
    '480': 'Rejeição: CFOP não permitido para CT-e',
    '481': 'Rejeição: CFOP inválido para operação com CT-e',
    '493': 'Rejeição: CT-e com tipo de serviço inválido',
    '494': 'Rejeição: CT-e com tipo de transporte inválido',
    '495': 'Rejeição: CT-e com modal inválido',
    '496': 'Rejeição: CT-e com tipo de documento fiscal inválido',
    '516': 'Rejeição: CT-e não encontra-se autorizado para uso',
    '517': 'Rejeição: CT-e não encontrado na base de dados da SEFAZ',
    '518': 'Rejeição: Data de autorização inválida',
    '539': 'Rejeição: Duplicidade de CT-e com diferença na chave de acesso',
    '540': 'Rejeição: CT-e referenciado não existe na base de dados da SEFAZ',
    '541': 'Rejeição: CT-e referenciado com diferença na chave de acesso',
    '542': 'Rejeição: CT-e referenciado com tipo de documento fiscal inválido',
    '543': 'Rejeição: CT-e referenciado com UF divergente',
    '544': 'Rejeição: CT-e referenciado com CNPJ divergente',
    '545': 'Rejeição: CT-e referenciado com data de emissão divergente',
    '546': 'Rejeição: CT-e referenciado com série divergente',
    '547': 'Rejeição: CT-e referenciado com número divergente',
    '548': 'Rejeição: CT-e referenciado com valor divergente',
    '549': 'Rejeição: CT-e referenciado com destinatário divergente',
    '550': 'Rejeição: CT-e referenciado com remetente divergente',
    '551': 'Rejeição: CT-e referenciado com destinatário inválido',
    '552': 'Rejeição: CT-e referenciado com remetente inválido',
    '553': 'Rejeição: CT-e referenciado com tipo de operação divergente',
    '554': 'Rejeição: CT-e referenciado com ICMS divergente',
    '555': 'Rejeição: CT-e referenciado com CFOP divergente',
    '556': 'Rejeição: CT-e referenciado com valor de ICMS divergente',
    '557': 'Rejeição: CT-e referenciado com valor de ICMS-ST divergente',
    '558': 'Rejeição: CT-e referenciado com valor de IPI divergente',
    '559': 'Rejeição: CT-e referenciado com valor de PIS divergente',
    '560': 'Rejeição: CT-e referenciado com valor de COFINS divergente',
    '561': 'Rejeição: CT-e referenciado com valor de frete divergente',
    '562': 'Rejeição: Chave de Acesso informada não existe',
    '563': 'Rejeição: Já existe pedido de inutilização com a mesma faixa de número',
    '564': 'Rejeição: A faixa a inutilizar não pertence ao emitente',
    '565': 'Rejeição: Faixa sem utilização',
    '567': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '568': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '569': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '570': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '578': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '579': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '580': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '591': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '600': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '601': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '602': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '603': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '612': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '613': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '614': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '615': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '625': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '626': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '627': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '628': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '631': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '632': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '633': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '634': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '637': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '638': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '639': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '640': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '643': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '644': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '645': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '646': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '649': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '650': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '651': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '652': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '655': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '656': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '657': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '658': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '661': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '662': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '663': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '664': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '667': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '668': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '669': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '670': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '673': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '674': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '675': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '676': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '679': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '680': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '681': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '682': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '685': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '686': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '687': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '688': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '691': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '692': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '693': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '694': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '697': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de inutilização',
    '698': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de cancelamento',
    '699': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de consulta',
    '700': 'Rejeição: CT-e com CPF/CNPJ diferente do pedido de download',
    '702': 'Rejeição: CT-e referenciado não encontrado',
    '703': 'Rejeição: CT-e referenciado com CNPJ divergente',
    '704': 'Rejeição: CT-e referenciado com tipo de operação divergente',
    '705': 'Rejeição: CT-e referenciado com CFOP divergente',
    '706': 'Rejeição: CT-e referenciado com modal divergente',
    '707': 'Rejeição: CT-e referenciado com UF de início divergente',
    '708': 'Rejeição: CT-e referenciado com UF de fim divergente',
    '709': 'Rejeição: CT-e referenciado com remetente divergente',
    '710': 'Rejeição: CT-e referenciado com destinatário divergente',
    '711': 'Rejeição: CT-e referenciado com valor divergente',
    '712': 'Rejeição: CT-e referenciado com ICMS divergente',
    '713': 'Rejeição: CT-e referenciado com valor de ICMS-ST divergente',
    '714': 'Rejeição: CT-e referenciado com valor de IPI divergente',
    '715': 'Rejeição: CT-e referenciado com valor de PIS divergente',
    '716': 'Rejeição: CT-e referenciado com valor de COFINS divergente',
    '717': 'Rejeição: CT-e referenciado com valor de frete divergente',
  }

  return errorMap[cStat] || `Erro SEFAZ CT-e: ${cStat} - ${_xMotivo}`
}

/**
 * Verifica se um código de erro é retryable
 */
function isRetryableError(cStat: string): boolean {
  const retryableCodes = ['108', '109', '105', '106', '402', '403', '404']
  return retryableCodes.includes(cStat)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// =============================================
// Public Functions
// =============================================

/**
 * Consulta CT-e by chave de acesso
 */
export async function consultaCte(
  chave: string,
  config: CteClientConfig
): Promise<CteConsultaResponse> {
  const startTime = Date.now()
  const maxRetries = config.maxRetries ?? MAX_RETRIES
  const timeout = config.timeout ?? TIMEOUT_MS

  const uf = config.uf || getUfFromChave(chave)
  if (!uf) {
    return {
      success: false,
      error: 'Não foi possível determinar a UF a partir da chave de acesso',
      friendlyError: 'Chave de acesso inválida - UF não identificada',
      tentativas: 0,
    }
  }

  const endpoint = getCteEndpoint(uf, config.ambiente)
  const soapEnvelope = buildCteConsultaProtocoloEnvelope(chave, config.ambiente, uf, config.cnpjCpf)

  let lastError: string | null = null
  let lastFriendlyError: string | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(endpoint.consulta, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'SOAPAction': 'http://www.portalfiscal.inf.br/cte/wsdl/CteConsultaProtocolo4/cteConsultaCT',
        },
        body: soapEnvelope,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`
        lastFriendlyError = response.status === 503
          ? 'SEFAZ indisponível no momento. Tente novamente em alguns minutos'
          : response.status === 403
            ? 'Certificado digital não autorizado para este webservice'
            : `Erro na comunicação com SEFAZ CT-e (HTTP ${response.status})`

        if (attempt < maxRetries) {
          await delay(RETRY_DELAY_MS * attempt)
          continue
        }
        break
      }

      const responseBody = await response.text()
      const result = parseCteConsultaResponse(responseBody)
      const tempoResposta = Date.now() - startTime

      if (result.cStat && result.cteStatus === 'ERRO' && !isRetryableError(result.cStat)) {
        return {
          success: false,
          data: result,
          error: `${result.cStat} - ${result.xMotivo}`,
          friendlyError: mapCteErrorToFriendly(result.cStat, result.xMotivo),
          tempoResposta,
          tentativas: attempt,
        }
      }

      return {
        success: result.cteStatus === 'AUTORIZADO',
        data: result,
        tempoResposta,
        tentativas: attempt,
      }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      lastError = isTimeout
        ? `Timeout após ${timeout}ms`
        : err instanceof Error ? err.message : 'Erro desconhecido'
      lastFriendlyError = isTimeout
        ? 'Tempo de resposta da SEFAZ excedido. Tente novamente'
        : 'Erro de comunicação com a SEFAZ CT-e. Verifique sua conexão'

      if (attempt < maxRetries) {
        await delay(RETRY_DELAY_MS * attempt)
        continue
      }
    }
  }

  const tempoResposta = Date.now() - startTime
  return {
    success: false,
    error: lastError || 'Erro desconhecido',
    friendlyError: lastFriendlyError || 'Erro na comunicação com SEFAZ CT-e',
    tempoResposta,
    tentativas: maxRetries,
  }
}

/**
 * Download CT-e XML autorizado
 */
export async function downloadCte(
  chave: string,
  config: CteClientConfig
): Promise<CteDownloadResponse> {
  const startTime = Date.now()
  const maxRetries = config.maxRetries ?? MAX_RETRIES
  const timeout = config.timeout ?? TIMEOUT_MS

  const uf = config.uf || getUfFromChave(chave)
  if (!uf) {
    return {
      success: false,
      error: 'Não foi possível determinar a UF a partir da chave de acesso',
      friendlyError: 'Chave de acesso inválida - UF não identificada',
      tentativas: 0,
    }
  }

  const endpoint = getCteEndpoint(uf, config.ambiente)
  const soapEnvelope = buildCteDownloadEnvelope(chave, config.ambiente, uf, config.cnpjCpf)

  let lastError: string | null = null
  let lastFriendlyError: string | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(endpoint.download, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/soap+xml; charset=utf-8',
          'SOAPAction': 'http://www.portalfiscal.inf.br/cte/wsdl/CteDownload4/cteDownloadCT',
        },
        body: soapEnvelope,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`
        lastFriendlyError = `Erro na comunicação com SEFAZ CT-e (HTTP ${response.status})`

        if (attempt < maxRetries) {
          await delay(RETRY_DELAY_MS * attempt)
          continue
        }
        break
      }

      const responseBody = await response.text()
      const result = parseCteDownloadResponse(responseBody)
      const tempoResposta = Date.now() - startTime

      return {
        success: result.xmlContent !== null,
        data: result,
        tempoResposta,
        tentativas: attempt,
      }
    } catch (err) {
      const isTimeout = err instanceof Error && err.name === 'AbortError'
      lastError = isTimeout
        ? `Timeout após ${timeout}ms`
        : err instanceof Error ? err.message : 'Erro desconhecido'
      lastFriendlyError = isTimeout
        ? 'Tempo de resposta da SEFAZ CT-e excedido'
        : 'Erro de comunicação com a SEFAZ CT-e'

      if (attempt < maxRetries) {
        await delay(RETRY_DELAY_MS * attempt)
        continue
      }
    }
  }

  const tempoResposta = Date.now() - startTime
  return {
    success: false,
    error: lastError || 'Erro desconhecido',
    friendlyError: lastFriendlyError || 'Erro na comunicação com SEFAZ CT-e',
    tempoResposta,
    tentativas: maxRetries,
  }
}
