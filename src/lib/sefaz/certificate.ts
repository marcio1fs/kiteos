/**
 * Gerenciamento de Certificado Digital A1 (.pfx)
 * Criptografia de senha e armazenamento seguro
 *
 * SECURITY FIXES:
 * - Removed hardcoded encryption key fallback
 * - Removed static salt (was shared across ALL tenants)
 * - Now uses per-encryption random salt stored alongside ciphertext
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { MIN_SECRET_LENGTH, isPlaceholderSecret, readEnv } from '@/lib/env'

// ============================================================================
// SECURITY FIX: Removed hardcoded fallback — must fail if env var not set
// ============================================================================
function getEncryptionKey(): string {
  // PASSO 6 (CFG-01): a regra vive em `@/lib/env` (obrigatório, mínimo de 32
  // caracteres, sem placeholder) e é checada na partida por `instrumentation.ts`.
  const key = readEnv().config.certEncryptionKey;
  if (!key || key.length < MIN_SECRET_LENGTH || isPlaceholderSecret(key)) {
    throw new Error(`FATAL: CERT_ENCRYPTION_KEY environment variable must be set (min ${MIN_SECRET_LENGTH} chars, not an example value). Refusing to use insecure default.`);
  }
  return key;
}

/**
 * Deriva chave de criptografia a partir da chave mestra + salt
 * SECURITY FIX: Salt is now per-encryption (random), not static
 */
function deriveKey(salt: Buffer): Buffer {
  return scryptSync(getEncryptionKey(), salt, 32)
}

/**
 * Criptografa a senha do certificado
 * Usa AES-256-GCM com IV aleatório e salt aleatório
 * Formato: salt:iv:authTag:encryptedData
 */
export function encryptPassword(password: string): string {
  const salt = randomBytes(32)  // SECURITY FIX: Random salt per encryption
  const key = deriveKey(salt)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(password, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * Descriptografa a senha do certificado
 * Suporta formato novo (salt:iv:authTag:encrypted) e legado (iv:authTag:encrypted)
 */
export function decryptPassword(encryptedPassword: string): string {
  try {
    const parts = encryptedPassword.split(':')

    if (parts.length === 4) {
      // New format: salt:iv:authTag:encryptedData
      const salt = Buffer.from(parts[0], 'hex')
      const iv = Buffer.from(parts[1], 'hex')
      const authTag = Buffer.from(parts[2], 'hex')
      const encrypted = parts[3]

      const key = deriveKey(salt)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)

      let decrypted = decipher.update(encrypted, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      return decrypted
    }

    if (parts.length === 3) {
      // Legacy format: iv:authTag:encryptedData (with static salt)
      const iv = Buffer.from(parts[0], 'hex')
      const authTag = Buffer.from(parts[1], 'hex')
      const encrypted = parts[2]

      // Legacy decryption with static salt for backward compatibility
      const legacySalt = Buffer.from('kiteos-sefaz-salt', 'utf8')
      const key = scryptSync(getEncryptionKey(), legacySalt, 32)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)

      let decrypted = decipher.update(encrypted, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      return decrypted
    }

    throw new Error('Formato de senha criptografada inválido')
  } catch {
    throw new Error('Falha ao descriptografar senha do certificado')
  }
}

/**
 * Criptografa conteúdo do arquivo PFX (base64) para armazenamento
 * Formato: salt:iv:authTag:encryptedData
 */
export function encryptFileContent(base64Content: string): string {
  const salt = randomBytes(32)  // SECURITY FIX: Random salt per encryption
  const key = deriveKey(salt)
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', key, iv)

  let encrypted = cipher.update(base64Content, 'utf8', 'hex')
  encrypted += cipher.final('hex')

  const authTag = cipher.getAuthTag()

  return `${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`
}

/**
 * Descriptografa conteúdo do arquivo PFX
 * Suporta formato novo e legado
 */
export function decryptFileContent(encryptedContent: string): string {
  try {
    const parts = encryptedContent.split(':')

    if (parts.length === 4) {
      // New format: salt:iv:authTag:encryptedData
      const salt = Buffer.from(parts[0], 'hex')
      const iv = Buffer.from(parts[1], 'hex')
      const authTag = Buffer.from(parts[2], 'hex')
      const encrypted = parts[3]

      const key = deriveKey(salt)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)

      let decrypted = decipher.update(encrypted, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      return decrypted
    }

    if (parts.length === 3) {
      // Legacy format: iv:authTag:encryptedData (with static salt)
      const iv = Buffer.from(parts[0], 'hex')
      const authTag = Buffer.from(parts[1], 'hex')
      const encrypted = parts[2]

      const legacySalt = Buffer.from('kiteos-sefaz-salt', 'utf8')
      const key = scryptSync(getEncryptionKey(), legacySalt, 32)
      const decipher = createDecipheriv('aes-256-gcm', key, iv)
      decipher.setAuthTag(authTag)

      let decrypted = decipher.update(encrypted, 'hex', 'utf8')
      decrypted += decipher.final('utf8')
      return decrypted
    }

    throw new Error('Formato de conteúdo criptografado inválido')
  } catch {
    throw new Error('Falha ao descriptografar conteúdo do certificado')
  }
}

/**
 * Valida se um arquivo PFX parece válido (verificação básica)
 */
export function validatePfxBasic(base64Content: string): { valid: boolean; error?: string } {
  try {
    const buffer = Buffer.from(base64Content, 'base64')
    if (buffer.length < 100) {
      return { valid: false, error: 'Arquivo PFX muito pequeno para ser válido' }
    }
    // PFX files start with specific ASN.1 sequence bytes (0x30 0x82 or 0x30 0x83)
    if (buffer[0] !== 0x30) {
      return { valid: false, error: 'Formato de arquivo PFX inválido' }
    }
    // SECURITY: File size limit (1MB max for PFX)
    if (buffer.length > 1024 * 1024) {
      return { valid: false, error: 'Arquivo PFX excede o tamanho máximo permitido (1MB)' }
    }
    return { valid: true }
  } catch {
    return { valid: false, error: 'Não foi possível ler o conteúdo do arquivo PFX' }
  }
}

/**
 * Mascara dados sensíveis para logs
 * SECURITY FIX: Now fully redacts instead of revealing first/last 3 chars
 */
export function maskSensitiveData(data: string): string {
  if (!data || data.length < 1) return '***REDACTED***'
  return '***REDACTED***'
}

/**
 * Valida o arquivo PFX e a senha, extraindo dados do certificado (validade, CNPJ, Razão Social)
 */
export function getCertificateDetails(base64Content: string, password: string) {
  // Lazy require on purpose: xml-signer imports this module, so a static import
  // here would create a circular dependency at load time.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { extractPfxData } = require('./xml-signer')
  const certData = extractPfxData(base64Content, password)

  return {
    valid: true,
    validade: certData.notAfter,
    dataInicio: certData.notBefore,
    cnpjCpf: certData.subject.cnpjCpf || null,
    razaoSocial: certData.subject.organization || certData.subject.commonName || null,
    emissor: certData.issuer.organization || certData.issuer.commonName || null,
  }
}
