/**
 * Testes unitários do Rate Limiter SEFAZ
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { checkRateLimit, type RateLimitType } from '@/lib/sefaz/rate-limiter'

describe('Rate Limiter SEFAZ', () => {
  const testOfficeId = 'test-office-rate-limit'

  describe('checkRateLimit - CONSULTA', () => {
    it('deve permitir requisições dentro do limite', () => {
      const result = checkRateLimit(testOfficeId, 'CONSULTA')
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBeGreaterThan(0)
    })

    it('deve bloquear após exceder o limite de consultas', () => {
      // Fazer mais requisições que o limite (30 para CONSULTA)
      let lastResult
      for (let i = 0; i < 35; i++) {
        lastResult = checkRateLimit(`test-burst-${Date.now()}`, 'CONSULTA')
      }
      // A última requisição deve ser bloqueada
      expect(lastResult!.allowed).toBe(false)
      expect(lastResult!.retryAfterMs).toBeGreaterThan(0)
    })

    it('deve retornar mensagem amigável quando bloqueado', () => {
      const officeId = `test-msg-${Date.now()}`
      // Exceder o limite
      for (let i = 0; i < 35; i++) {
        checkRateLimit(officeId, 'CONSULTA')
      }
      const result = checkRateLimit(officeId, 'CONSULTA')
      expect(result.message).toContain('Limite')
      expect(result.message).toContain('excedido')
    })

    it('deve ter limites diferentes para cada tipo de operação', () => {
      const officeId = `test-types-${Date.now()}`
      
      // CONSULTA: 30 req/min
      const consultaResult = checkRateLimit(officeId, 'CONSULTA')
      expect(consultaResult.allowed).toBe(true)
      expect(consultaResult.remaining).toBeLessThanOrEqual(30)

      // IMPORTACAO: 10 req/min
      const importResult = checkRateLimit(officeId, 'IMPORTACAO')
      expect(importResult.allowed).toBe(true)

      // CERTIFICADO: 5 req/min
      const certResult = checkRateLimit(officeId, 'CERTIFICADO')
      expect(certResult.allowed).toBe(true)

      // STATUS: 6 req/min
      const statusResult = checkRateLimit(officeId, 'STATUS')
      expect(statusResult.allowed).toBe(true)
    })

    it('deve isolar limites por officeId', () => {
      const office1 = `office1-${Date.now()}`
      const office2 = `office2-${Date.now()}`

      // Office 1 faz consultas
      checkRateLimit(office1, 'CONSULTA')
      checkRateLimit(office1, 'CONSULTA')

      // Office 2 deve ter contagem separada
      const result2 = checkRateLimit(office2, 'CONSULTA')
      expect(result2.allowed).toBe(true)
      // Office 2 deve ter quase todo o limite disponível
      expect(result2.remaining).toBeGreaterThanOrEqual(28)
    })
  })
})
