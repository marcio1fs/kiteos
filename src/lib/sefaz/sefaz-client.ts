/**
 * Cliente SEFAZ - Comunicação com webservices
 * Implementa consulta protocolo, download NF-e e status serviço
 * Com retry automático, timeout e tratamento de erros
 */

import { getSefazEndpoint, getUfFromChave, type Ambiente } from './endpoints'
import { buildConsultaProtocoloEnvelope, buildDownloadNfeEnvelope, buildStatusServicoEnvelope } from './soap-builder'
import { parseConsultaProtocoloResponse, parseDownloadNfeResponse, parseStatusServicoResponse, mapSefazErrorToFriendly, type SefazConsultaResult, type SefazDownloadResult } from './response-parser'

// Configurações
const TIMEOUT_MS = 15000  // 15 segundos
const MAX_RETRIES = 3
const RETRY_DELAY_MS = 1000 // 1 segundo entre tentativas

export interface SefazClientConfig {
  ambiente: Ambiente
  uf?: string           // UF override (se não informado, extrai da chave)
  cnpjCpf: string       // CNPJ/CPF do certificado
  timeout?: number      // Timeout em ms
  maxRetries?: number   // Máximo de tentativas
}

export interface SefazConsultaResponse {
  success: boolean
  data?: SefazConsultaResult
  error?: string
  friendlyError?: string
  tempoResposta?: number
  tentativas: number
}

export interface SefazDownloadResponse {
  success: boolean
  data?: SefazDownloadResult
  error?: string
  friendlyError?: string
  tempoResposta?: number
  tentativas: number
}

export interface SefazStatusResponse {
  success: boolean
  cStat?: string
  xMotivo?: string
  tMed?: string | null
  error?: string
  tempoResposta?: number
}

/**
 * Consulta Protocolo NF-e na SEFAZ
 */
export async function consultaProtocolo(
  chave: string,
  config: SefazClientConfig
): Promise<SefazConsultaResponse> {
  const startTime = Date.now()
  const maxRetries = config.maxRetries ?? MAX_RETRIES
  const timeout = config.timeout ?? TIMEOUT_MS

  // Determinar UF
  const uf = config.uf || getUfFromChave(chave)
  if (!uf) {
    return {
      success: false,
      error: 'Não foi possível determinar a UF a partir da chave de acesso',
      friendlyError: 'Chave de acesso inválida - UF não identificada',
      tentativas: 0,
    }
  }

  const endpoint = getSefazEndpoint(uf, config.ambiente)
  const soapEnvelope = buildConsultaProtocoloEnvelope(chave, config.ambiente, uf, config.cnpjCpf)

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
          'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4/nfeConsultaNF',
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
            : `Erro na comunicação com SEFAZ (HTTP ${response.status})`

        if (attempt < maxRetries) {
          await delay(RETRY_DELAY_MS * attempt)
          continue
        }
        break
      }

      const responseBody = await response.text()
      const result = parseConsultaProtocoloResponse(responseBody)
      const tempoResposta = Date.now() - startTime

      // Verificar se a resposta é um erro de negócio (não deve retry)
      if (result.cStat && result.nfeStatus === 'ERRO' && !isRetryableError(result.cStat)) {
        return {
          success: false,
          data: result,
          error: `${result.cStat} - ${result.xMotivo}`,
          friendlyError: mapSefazErrorToFriendly(result.cStat, result.xMotivo),
          tempoResposta,
          tentativas: attempt,
        }
      }

      return {
        success: result.nfeStatus === 'AUTORIZADA',
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

/**
 * Download do XML autorizado da NF-e
 */
export async function downloadNfe(
  chave: string,
  config: SefazClientConfig
): Promise<SefazDownloadResponse> {
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

  const endpoint = getSefazEndpoint(uf, config.ambiente)
  const soapEnvelope = buildDownloadNfeEnvelope(chave, config.ambiente, uf, config.cnpjCpf)

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
          'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NfeDownloadNF4/nfeDownloadNF',
        },
        body: soapEnvelope,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        lastError = `HTTP ${response.status}: ${response.statusText}`
        lastFriendlyError = `Erro na comunicação com SEFAZ (HTTP ${response.status})`

        if (attempt < maxRetries) {
          await delay(RETRY_DELAY_MS * attempt)
          continue
        }
        break
      }

      const responseBody = await response.text()
      const result = parseDownloadNfeResponse(responseBody)
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
        ? 'Tempo de resposta da SEFAZ excedido'
        : 'Erro de comunicação com a SEFAZ'

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

/**
 * Consulta Status do Serviço SEFAZ
 */
export async function consultaStatusServico(
  config: SefazClientConfig
): Promise<SefazStatusResponse> {
  const startTime = Date.now()
  const timeout = config.timeout ?? TIMEOUT_MS

  if (!config.uf) {
    return {
      success: false,
      error: 'UF é obrigatória para consulta de status',
    }
  }

  const endpoint = getSefazEndpoint(config.uf, config.ambiente)
  const soapEnvelope = buildStatusServicoEnvelope(config.ambiente, config.uf)

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(endpoint.statusServico, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/soap+xml; charset=utf-8',
        'SOAPAction': 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF',
      },
      body: soapEnvelope,
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
        tempoResposta: Date.now() - startTime,
      }
    }

    const responseBody = await response.text()
    const result = parseStatusServicoResponse(responseBody)
    const tempoResposta = Date.now() - startTime

    return {
      success: result.cStat === '107', // 107 = Serviço em Operação
      cStat: result.cStat,
      xMotivo: result.xMotivo,
      tMed: result.tMed,
      tempoResposta,
    }
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === 'AbortError'
    return {
      success: false,
      error: isTimeout ? 'Timeout' : (err instanceof Error ? err.message : 'Erro desconhecido'),
      tempoResposta: Date.now() - startTime,
    }
  }
}

/**
 * Verifica se um código de erro é retryable
 */
function isRetryableError(cStat: string): boolean {
  // Erros de infraestrutura que podem funcionar ao tentar novamente
  const retryableCodes = ['108', '109', '105', '106', '402', '403', '404']
  return retryableCodes.includes(cStat)
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
