/**
 * Manifestação do Destinatário - Serviço de envio de eventos
 * Conforme NT 2014.002 e Manual de Orientação do Contribuinte
 *
 * Tipos de evento:
 * - Ciência da Operação (210210)
 * - Confirmação da Operação (210200)
 * - Desconhecimento da Operação (210220)
 * - Operação não Realizada (210240)
 */

import { type Ambiente } from './endpoints'
import { signXml } from './xml-signer'
import { sefazSoapRequest } from './mtls-client'

// =============================================
// TIPOS E CONSTANTES
// =============================================

export type TipoManifestacao =
  | 'CIENCIA_OPERACAO'
  | 'CONFIRMACAO_OPERACAO'
  | 'DESCONHECIMENTO_OPERACAO'
  | 'OPERACAO_NAO_REALIZADA'

export const MANIFESTACAO_EVENTOS: Record<TipoManifestacao, { codigo: string; descricao: string }> = {
  CIENCIA_OPERACAO: { codigo: '210210', descricao: 'Ciência da Operação' },
  CONFIRMACAO_OPERACAO: { codigo: '210200', descricao: 'Confirmação da Operação' },
  DESCONHECIMENTO_OPERACAO: { codigo: '210220', descricao: 'Desconhecimento da Operação' },
  OPERACAO_NAO_REALIZADA: { codigo: '210240', descricao: 'Operação não Realizada' },
}

export interface ManifestacaoConfig {
  ambiente: Ambiente
  uf: string
  cnpjCpf: string       // CNPJ do destinatário
  pfx?: string | Buffer // Arquivo PFX para assinatura e mTLS
  passphrase?: string   // Senha do certificado
  timeout?: number
  maxRetries?: number
}

export interface ManifestacaoResult {
  success: boolean
  data?: {
    cStat: string
    xMotivo: string
    nProt: string | null
    dhRegEvento: string | null
  }
  error?: string
  friendlyError?: string
  tempoResposta?: number
  tentativas: number
}

// =============================================
// ENDPOINTS RECEPÇÃO EVENTO (AN - Ambiente Nacional)
// =============================================

/**
 * Endpoints do webservice RecepcaoEvento4 (Ambiente Nacional)
 * A Manifestação do Destinatário é sempre enviada para a AN (cOrgao=91)
 */
const RECEPCAO_EVENTO_ENDPOINTS: Record<Ambiente, string> = {
  HOMOLOGACAO: 'https://hom.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
  PRODUCAO: 'https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx',
}

// Configurações de retry
const TIMEOUT_MS = 15000
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000

// =============================================
// CONSTRUÇÃO DO ENVELOPE SOAP
// =============================================

/**
 * Constrói o envelope SOAP para envio de Manifestação do Destinatário
 * Serviço: NFeRecepcaoEvento4
 * Se o certificado (pfx e senha) for fornecido, assina digitalmente o bloco infEvento via XMLDSig (RSA-SHA1)
 */
export function buildManifestacaoEnvelope(
  chave: string,
  tipoEvento: TipoManifestacao,
  cnpjDestinatario: string,
  ambiente: string,
  justificativa?: string,
  certOptions?: { pfx: string | Buffer; passphrase?: string }
): string {
  const eventoInfo = MANIFESTACAO_EVENTOS[tipoEvento]
  const tpAmb = ambiente === 'PRODUCAO' ? '1' : '2'
  const dhEvento = formatDateTime(new Date())
  const nSeqEvento = '1'
  const verEvento = '1.00'

  // Limpar CNPJ (remover formatação)
  const cnpjClean = cnpjDestinatario.replace(/\D/g, '')

  // Construir detEvento
  let detEventoXml = `<detEvento versao="${verEvento}">
      <descEvento>${eventoInfo.descricao}</descEvento>`

  if (tipoEvento === 'OPERACAO_NAO_REALIZADA' && justificativa) {
    // xJust limitado a 255 caracteres conforme especificação SEFAZ
    const xJust = justificativa.substring(0, 255)
    detEventoXml += `
      <xJust>${escapeXml(xJust)}</xJust>`
  }

  detEventoXml += `
    </detEvento>`

  // ID do evento: ID + tpEvento + chave + nSeqEvento (com 2 dígitos, ex: 01)
  const nSeqPadded = nSeqEvento.padStart(2, '0')
  const eventoId = `ID${eventoInfo.codigo}${chave}${nSeqPadded}`

  // Bloco evento
  let eventoXml = `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
          <infEvento Id="${eventoId}">
            <cOrgao>91</cOrgao>
            <tpAmb>${tpAmb}</tpAmb>
            <CNPJ>${escapeXml(cnpjClean)}</CNPJ>
            <chNFe>${escapeXml(chave)}</chNFe>
            <dhEvento>${dhEvento}</dhEvento>
            <tpEvento>${eventoInfo.codigo}</tpEvento>
            <nSeqEvento>${nSeqEvento}</nSeqEvento>
            <verEvento>${verEvento}</verEvento>
            ${detEventoXml}
          </infEvento>
        </evento>`

  // Se certificado foi fornecido, assinar o XML digitalmente
  if (certOptions?.pfx && certOptions.passphrase) {
    const signResult = signXml({
      xml: eventoXml,
      tagToSign: 'infEvento',
      pfx: certOptions.pfx,
      passphrase: certOptions.passphrase,
      algorithm: 'sha1',
    })

    if (signResult.success) {
      eventoXml = signResult.signedXml
    }
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap12:Header>
    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">
      <cUF>91</cUF>
      <versaoDados>1.00</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">
      <envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
        <idLote>${generateLoteId()}</idLote>
        ${eventoXml}
      </envEvento>
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`
}

// =============================================
// PARSER DE RESPOSTA
// =============================================

/**
 * Faz o parse da resposta SOAP do webservice RecepcaoEvento4
 * Extrai: cStat, xMotivo, nProt, dhRegEvento
 */
export function parseManifestacaoResponse(soapResponse: string): {
  cStat: string
  xMotivo: string
  nProt: string | null
  dhRegEvento: string | null
} {
  // Extrair corpo do SOAP
  const body = extractBlock(soapResponse, 'soap:Body')
    || extractBlock(soapResponse, 'soap12:Body')
    || extractBlock(soapResponse, 'Body')
    || soapResponse

  // Extrair retEnvEvento
  const retEnvEvento = extractBlock(body, 'retEnvEvento') || body

  // Extrair retEvento (pode haver múltiplos, pegamos o primeiro)
  const retEvento = extractBlock(retEnvEvento, 'retEvento') || retEnvEvento

  // Extrair infEvento
  const infEvento = extractBlock(retEvento, 'infEvento') || retEvento

  const cStat = extractValue(infEvento, 'cStat') || ''
  const xMotivo = extractValue(infEvento, 'xMotivo') || 'Resposta não identificada'
  const nProt = extractValue(infEvento, 'nProt')
  const dhRegEvento = extractValue(infEvento, 'dhRegEvento')

  return {
    cStat,
    xMotivo,
    nProt,
    dhRegEvento,
  }
}

// =============================================
// MAPEAMENTO DE ERROS
// =============================================

/**
 * Mapeia cStat de retorno de evento de manifestação para mensagem amigável
 */
export function mapManifestacaoErrorToFriendly(cStat: string, xMotivo: string): string {
  const errorMap: Record<string, string> = {
    '128': 'Lote de evento processado com sucesso',
    '135': 'Evento registrado e vinculado à NF-e',
    '136': 'Evento registrado, mas não vinculado à NF-e',
    '137': 'Nenhum documento localizado para o Destinatário',
    '138': 'Documento localizado para o Destinatário',
    '139': 'Pedido de Download processado',
    '140': 'Download disponibilizado',
    '155': 'Cancelamento de NF-e homologado fora de prazo',
    '573': 'Rejeição: Duplicidade de evento',
    '574': 'Rejeição: O evento exige um CNPJ',
    '575': 'Rejeição: O evento exige um CPF',
    '576': 'Rejeição: Data do evento não pode ser maior que a data atual',
    '577': 'Rejeição: Data do evento não pode ser menor que a data de autorização da NF-e',
    '578': 'Rejeição: A data do evento deve ser menor ou igual a data atual',
    '579': 'Rejeição: Já existe evento de manifestação para esta NF-e com o mesmo tipo',
    '580': 'Rejeição: O evento de manifestação não pode ser registrado para NF-e cancelada/denegada',
    '587': 'Rejeição: CNPJ do destinatário inválido',
    '588': 'Rejeição: CPF do destinatário inválido',
    '589': 'Rejeição: Chave de acesso inválida',
    '590': 'Rejeição: Tipo de evento inválido para o destinatário',
    '591': 'Rejeição: Código do órgão inválido para a operação',
    '592': 'Rejeição: NF-e inexistente para a UF informada',
    '593': 'Rejeição: CNPJ do autor do evento inválido',
    '594': 'Rejeição: CPF do autor do evento inválido',
    '595': 'Rejeição: Obrigatória a informação da justificativa do evento',
    '596': 'Rejeição: Justificativa do evento com tamanho superior ao limite',
    '597': 'Rejeição: NF-e não autorizada para o destinatário informado',
    '598': 'Rejeição: Usabilidade indisponível para a operação',
    '599': 'Rejeição: CPF/CNPJ do destinatário difere do informado na NF-e',
    '629': 'Rejeição: CNPJ do destinatário não corresponde ao informado na NF-e',
    '630': 'Rejeição: CPF do destinatário não corresponde ao informado na NF-e',
    '631': 'Rejeição: CFOP inválido para operação de manifesto de destinatário',
    '632': 'Rejeição: Tipo de evento não permitido para a operação',
    '633': 'Rejeição: Destinatário já manifestou ciência para esta NF-e',
    '634': 'Rejeição: Destinatário já confirmou a operação para esta NF-e',
    '635': 'Rejeição: Destinatário já declarou desconhecimento da operação para esta NF-e',
    '636': 'Rejeição: Destinatário já declarou operação não realizada para esta NF-e',
  }

  return errorMap[cStat] || xMotivo || 'Erro desconhecido na manifestação do destinatário'
}

// =============================================
// CLIENTE PRINCIPAL
// =============================================

/**
 * Envia evento de Manifestação do Destinatário para a SEFAZ
 * Usa o webservice NFeRecepcaoEvento4 (Ambiente Nacional)
 *
 * @param chave Chave de acesso da NF-e (44 dígitos)
 * @param tipoEvento Tipo de manifestação
 * @param config Configuração do cliente (ambiente, CNPJ, etc.)
 * @param justificativa Obrigatória para OPERACAO_NAO_REALIZADA
 */
export async function enviarManifestacao(
  chave: string,
  tipoEvento: TipoManifestacao,
  config: ManifestacaoConfig,
  justificativa?: string
): Promise<ManifestacaoResult> {
  const startTime = Date.now()
  const maxRetries = config.maxRetries ?? MAX_RETRIES
  const timeout = config.timeout ?? TIMEOUT_MS

  // Validações prévias
  if (tipoEvento === 'OPERACAO_NAO_REALIZADA' && !justificativa) {
    return {
      success: false,
      error: 'Justificativa é obrigatória para Operação não Realizada',
      friendlyError: 'Para declarar operação não realizada, é necessário informar uma justificativa',
      tentativas: 0,
    }
  }

  // Validar chave
  const chaveClean = chave.replace(/\D/g, '')
  if (chaveClean.length !== 44) {
    return {
      success: false,
      error: 'Chave de acesso inválida - deve conter 44 dígitos',
      friendlyError: 'Chave de acesso inválida. Verifique se contém 44 dígitos numéricos',
      tentativas: 0,
    }
  }

  // Validar tipo de evento
  if (!MANIFESTACAO_EVENTOS[tipoEvento]) {
    return {
      success: false,
      error: `Tipo de evento inválido: ${tipoEvento}`,
      friendlyError: 'Tipo de manifestação inválido. Use: CIENCIA_OPERACAO, CONFIRMACAO_OPERACAO, DESCONHECIMENTO_OPERACAO ou OPERACAO_NAO_REALIZADA',
      tentativas: 0,
    }
  }

  // Validar justificativa para OPERACAO_NAO_REALIZADA
  if (tipoEvento === 'OPERACAO_NAO_REALIZADA' && justificativa && justificativa.length < 15) {
    return {
      success: false,
      error: 'Justificativa deve ter no mínimo 15 caracteres',
      friendlyError: 'A justificativa de operação não realizada deve ter no mínimo 15 caracteres',
      tentativas: 0,
    }
  }

  // Obter endpoint
  const endpoint = RECEPCAO_EVENTO_ENDPOINTS[config.ambiente]

  // Construir envelope SOAP (com assinatura se certificado fornecido)
  const soapEnvelope = buildManifestacaoEnvelope(
    chaveClean,
    tipoEvento,
    config.cnpjCpf,
    config.ambiente,
    justificativa,
    config.pfx ? { pfx: config.pfx, passphrase: config.passphrase } : undefined
  )

  let lastError: string | null = null
  let lastFriendlyError: string | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await sefazSoapRequest({
        url: endpoint,
        body: soapEnvelope,
        soapAction: 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento',
        pfx: config.pfx,
        passphrase: config.passphrase,
        timeoutMs: timeout,
      })

      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`
        lastFriendlyError = response.status === 503
          ? 'SEFAZ indisponível no momento. Tente novamente em alguns minutos'
          : response.status === 403
            ? 'Certificado digital não autorizado para este webservice'
            : `Erro na comunicação com SEFAZ (HTTP ${response.status})`

        if (attempt < maxRetries) {
          await delay(RETRY_DELAY_MS * attempt)
          continue
        }
        break
      }

      const responseBody = response.body
      const result = parseManifestacaoResponse(responseBody)
      const tempoResposta = Date.now() - startTime

      // cStat 135 = Evento registrado e vinculado à NF-e (sucesso)
      // cStat 128 = Lote processado (sucesso - verificar eventos internos)
      const isRetryable = isRetryableManifestacaoError(result.cStat)

      if (!isSuccessCode(result.cStat) && isRetryable) {
        lastError = `${result.cStat} - ${result.xMotivo}`
        lastFriendlyError = mapManifestacaoErrorToFriendly(result.cStat, result.xMotivo)

        if (attempt < maxRetries) {
          await delay(RETRY_DELAY_MS * attempt)
          continue
        }

        return {
          success: false,
          data: result,
          error: lastError,
          friendlyError: lastFriendlyError,
          tempoResposta,
          tentativas: attempt,
        }
      }

      // Resultado final (sucesso ou erro não retryable)
      const success = isSuccessCode(result.cStat)

      return {
        success,
        data: result,
        error: success ? undefined : `${result.cStat} - ${result.xMotivo}`,
        friendlyError: success ? undefined : mapManifestacaoErrorToFriendly(result.cStat, result.xMotivo),
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
        : 'Erro de comunicação com a SEFAZ. Verifique sua conexão'

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
    friendlyError: lastFriendlyError || 'Erro na comunicação com SEFAZ',
    tempoResposta,
    tentativas: maxRetries,
  }
}

// =============================================
// FUNÇÕES AUXILIARES
// =============================================

/**
 * Verifica se o cStat indica sucesso na manifestação
 * 135 = Evento registrado e vinculado à NF-e
 * 136 = Evento registrado, mas não vinculado (para eventos de manifestação, 135 é o sucesso real)
 */
function isSuccessCode(cStat: string): boolean {
  return cStat === '135'
}

/**
 * Verifica se um código de erro é retryable
 */
function isRetryableManifestacaoError(cStat: string): boolean {
  const retryableCodes = ['108', '109', '105', '106', '402', '403', '404']
  return retryableCodes.includes(cStat)
}

/**
 * Formata data/hora no formato AAAA-MM-DDTHH:MM:SS-03:00 (fuso Brasil)
 */
function formatDateTime(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hour = pad(date.getHours())
  const min = pad(date.getMinutes())
  const sec = pad(date.getSeconds())

  // Obter offset do fuso horário
  const offset = -date.getTimezoneOffset()
  const offsetHours = Math.floor(Math.abs(offset) / 60)
  const offsetMin = Math.abs(offset) % 60
  const offsetSign = offset >= 0 ? '+' : '-'
  const tzOffset = `${offsetSign}${pad(offsetHours)}:${pad(offsetMin)}`

  return `${year}-${month}-${day}T${hour}:${min}:${sec}${tzOffset}`
}

/**
 * Gera ID de lote numérico (timestamp + random)
 */
function generateLoteId(): string {
  const timestamp = Date.now().toString()
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0')
  return timestamp + random
}

/**
 * Escapa caracteres especiais XML
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

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
 * Escapa caracteres especiais de regex
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Delay helper
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
