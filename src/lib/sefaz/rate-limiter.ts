/**
 * Rate Limiter para endpoints SEFAZ
 * Limita requisições por officeId para evitar sobrecarga na SEFAZ
 * e abusos na API
 */

interface RateLimitEntry {
  count: number
  resetAt: number
  blocked: boolean
  blockedUntil: number
}

// Configuração por tipo de operação
interface RateLimitConfig {
  maxRequests: number    // Máximo de requisições por janela
  windowMs: number       // Tamanho da janela em ms
  blockDurationMs: number // Duração do bloqueio ao exceder
}

const SEFAZ_CONSULTA_CONFIG: RateLimitConfig = {
  maxRequests: 30,       // 30 consultas por minuto por office
  windowMs: 60_000,      // 1 minuto
  blockDurationMs: 60_000, // bloqueia por 1 minuto ao exceder
}

const SEFAZ_IMPORTACAO_CONFIG: RateLimitConfig = {
  maxRequests: 10,       // 10 importações por minuto por office
  windowMs: 60_000,      // 1 minuto
  blockDurationMs: 120_000, // bloqueia por 2 minutos ao exceder
}

const SEFAZ_CERTIFICADO_CONFIG: RateLimitConfig = {
  maxRequests: 5,        // 5 operações de certificado por minuto
  windowMs: 60_000,
  blockDurationMs: 300_000, // bloqueia por 5 minutos ao exceder
}

const SEFAZ_STATUS_CONFIG: RateLimitConfig = {
  maxRequests: 6,        // 6 verificações de status por minuto
  windowMs: 60_000,
  blockDurationMs: 60_000,
}

// Armazenamento em memória (para produção, usar Redis)
const store = new Map<string, RateLimitEntry>()

// Limpeza periódica de entradas expiradas (a cada 5 minutos)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of store.entries()) {
      if (entry.resetAt < now && !entry.blocked) {
        store.delete(key)
      } else if (entry.blocked && entry.blockedUntil < now) {
        store.delete(key)
      }
    }
  }, 5 * 60_000)
}

export type RateLimitType = 'CONSULTA' | 'IMPORTACAO' | 'CERTIFICADO' | 'STATUS'

const CONFIG_MAP: Record<RateLimitType, RateLimitConfig> = {
  CONSULTA: SEFAZ_CONSULTA_CONFIG,
  IMPORTACAO: SEFAZ_IMPORTACAO_CONFIG,
  CERTIFICADO: SEFAZ_CERTIFICADO_CONFIG,
  STATUS: SEFAZ_STATUS_CONFIG,
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  resetAt: number
  retryAfterMs?: number
  message?: string
}

/**
 * Verifica se uma requisição está dentro do limite de taxa
 * @param officeId ID do escritório/tenant
 * @param type Tipo de operação SEFAZ
 * @returns Resultado da verificação com informações sobre o limite
 */
export function checkRateLimit(officeId: string, type: RateLimitType): RateLimitResult {
  const config = CONFIG_MAP[type]
  const key = `${type}:${officeId}`
  const now = Date.now()

  let entry = store.get(key)

  // Se está bloqueado, verificar se o bloqueio expirou
  if (entry?.blocked) {
    if (now < entry.blockedUntil) {
      const retryAfterMs = entry.blockedUntil - now
      return {
        allowed: false,
        remaining: 0,
        resetAt: entry.blockedUntil,
        retryAfterMs,
        message: `Limite de requisições excedido. Tente novamente em ${Math.ceil(retryAfterMs / 1000)} segundos.`,
      }
    }
    // Bloqueio expirado, resetar
    entry = undefined
    store.delete(key)
  }

  // Se não existe ou a janela expirou, criar nova entrada
  if (!entry || entry.resetAt < now) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetAt: now + config.windowMs,
      blocked: false,
      blockedUntil: 0,
    }
    store.set(key, newEntry)
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt: newEntry.resetAt,
    }
  }

  // Janela ainda válida, incrementar contador
  entry.count++

  if (entry.count > config.maxRequests) {
    // Excedeu o limite - bloquear
    entry.blocked = true
    entry.blockedUntil = now + config.blockDurationMs

    const retryAfterMs = config.blockDurationMs
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.blockedUntil,
      retryAfterMs,
      message: `Limite de ${config.maxRequests} requisições por minuto excedido para operação ${type}. Tente novamente em ${Math.ceil(retryAfterMs / 1000)} segundos.`,
    }
  }

  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
  }
}

/**
 * Middleware helper para aplicar rate limiting em rotas SEFAZ
 * Retorna resposta de erro 429 se o limite for excedido
 */
export function applyRateLimit(officeId: string, type: RateLimitType): RateLimitResult | null {
  const result = checkRateLimit(officeId, type)
  if (!result.allowed) {
    return result
  }
  return null // Permitido
}
