/**
 * Testes unitários do gerenciamento de Certificado Digital
 * SECURITY FIX: Updated to match current security-hardened implementation
 * - encryptPassword now uses per-encryption random salt (4 parts, not 3)
 * - maskSensitiveData now fully redacts (***REDACTED***) instead of partial reveal
 * - CERT_ENCRYPTION_KEY must be set for tests to work
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  encryptPassword,
  decryptPassword,
  encryptFileContent,
  decryptFileContent,
  validatePfxBasic,
  maskSensitiveData,
} from '@/lib/sefaz/certificate'

describe('Certificate Management', () => {
  // Set CERT_ENCRYPTION_KEY for tests
  beforeAll(() => {
    if (!process.env.CERT_ENCRYPTION_KEY) {
      process.env.CERT_ENCRYPTION_KEY = 'test-encryption-key-for-unit-tests-min-32chars';
    }
  });

  describe('encryptPassword / decryptPassword', () => {
    it('deve criptografar e descriptografar senhas corretamente', () => {
      const senha = 'minha-senha-secreta-123'
      const encrypted = encryptPassword(senha)
      
      // Senha criptografada deve ser diferente da original
      expect(encrypted).not.toBe(senha)
      
      // SECURITY FIX: Now uses 4 parts (salt:iv:authTag:encryptedData) instead of 3
      expect(encrypted.split(':')).toHaveLength(4)
      
      // Deve descriptografar para a senha original
      const decrypted = decryptPassword(encrypted)
      expect(decrypted).toBe(senha)
    })

    it('deve gerar criptografias diferentes para a mesma senha (IV e salt aleatórios)', () => {
      const senha = 'senha-teste'
      const encrypted1 = encryptPassword(senha)
      const encrypted2 = encryptPassword(senha)
      
      // Cada criptografia deve gerar um resultado diferente (devido ao IV e salt aleatórios)
      expect(encrypted1).not.toBe(encrypted2)
      
      // Mas ambas devem descriptografar para a mesma senha
      expect(decryptPassword(encrypted1)).toBe(senha)
      expect(decryptPassword(encrypted2)).toBe(senha)
    })

    it('deve lançar erro ao descriptografar formato inválido', () => {
      expect(() => decryptPassword('formato-invalido')).toThrow()
      expect(() => decryptPassword('abc:def')).toThrow()
    })
  })

  describe('encryptFileContent / decryptFileContent', () => {
    it('deve criptografar e descriptografar conteúdo base64', () => {
      const base64Content = Buffer.from('conteudo do arquivo PFX simulado').toString('base64')
      const encrypted = encryptFileContent(base64Content)
      
      expect(encrypted).not.toBe(base64Content)
      // SECURITY FIX: Now uses 4 parts (salt:iv:authTag:encryptedData)
      expect(encrypted.split(':')).toHaveLength(4)
      
      const decrypted = decryptFileContent(encrypted)
      expect(decrypted).toBe(base64Content)
    })
  })

  describe('validatePfxBasic', () => {
    it('deve aceitar conteúdo PFX que começa com byte 0x30', () => {
      const buffer = Buffer.alloc(200)
      buffer[0] = 0x30
      const base64 = buffer.toString('base64')
      
      const result = validatePfxBasic(base64)
      expect(result.valid).toBe(true)
    })

    it('deve rejeitar conteúdo muito pequeno', () => {
      const buffer = Buffer.alloc(50)
      buffer[0] = 0x30
      const base64 = buffer.toString('base64')
      
      const result = validatePfxBasic(base64)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('pequeno')
    })

    it('deve rejeitar conteúdo que não começa com 0x30', () => {
      const buffer = Buffer.alloc(200)
      buffer[0] = 0x20
      const base64 = buffer.toString('base64')
      
      const result = validatePfxBasic(base64)
      expect(result.valid).toBe(false)
      expect(result.error).toContain('inválido')
    })
  })

  describe('maskSensitiveData', () => {
    // SECURITY FIX: maskSensitiveData now fully redacts instead of partial reveal
    it('deve redact completamente dados sensíveis', () => {
      expect(maskSensitiveData('1234567890')).toBe('***REDACTED***')
    })

    it('deve redact dados muito curtos', () => {
      expect(maskSensitiveData('abc')).toBe('***REDACTED***')
      expect(maskSensitiveData('')).toBe('***REDACTED***')
    })
  })
})
