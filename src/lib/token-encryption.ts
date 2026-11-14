/**
 * Token Encryption Module
 *
 * SECURITY FIX (#79): Encrypts sensitive tokens (API keys, secrets) at rest
 * Uses the same AES-256-GCM encryption as certificate.ts for consistency
 *
 * Tokens encrypted: mpAccessToken, mpRefreshToken, mpWebhookSecret, waApiToken, waWebhookSecret
 *
 * PASSO 6 (CFG-05): sem `CERT_ENCRYPTION_KEY` este módulo **lança** em vez de
 * gravar em texto puro. O comportamento antigo era "se NODE_ENV !== 'production',
 * grava plaintext com um console.warn" — o que significa que um staging, um
 * container sem NODE_ENV, ou qualquer valor diferente de exatamente "production"
 * persistia token de pagamento legível no banco, sem falhar nada. `NODE_ENV` não é
 * um sinal confiável de "posso ser inseguro"; agora é opt-in explícito
 * (`ALLOW_INSECURE_PLAINTEXT_TOKENS=true`, ignorado em produção).
 */

import { encryptPassword, decryptPassword } from '@/lib/sefaz/certificate';
import { readEnv } from '@/lib/env';

// Prefix to identify encrypted tokens (vs plaintext legacy tokens)
const ENCRYPTED_PREFIX = 'ENC:';

/**
 * Encrypt a sensitive token for storage. Returns 'ENC:<encrypted_data>'.
 *
 * Lança quando não é possível criptografar. A única exceção é o opt-in explícito
 * `ALLOW_INSECURE_PLAINTEXT_TOKENS=true` fora de produção, que existe para
 * desenvolvimento local e para os testes — e que `readEnv()` recusa em produção.
 */
export function encryptToken(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;

  // Already encrypted — don't double-encrypt
  if (plaintext.startsWith(ENCRYPTED_PREFIX)) return plaintext;

  const { config } = readEnv();
  try {
    const encrypted = encryptPassword(plaintext);
    return `${ENCRYPTED_PREFIX}${encrypted}`;
  } catch (error) {
    if (config.allowInsecurePlaintextTokens) {
      console.warn(
        '[TokenEncryption] ALLOW_INSECURE_PLAINTEXT_TOKENS=true: gravando token em texto puro. ' +
          'Válido apenas fora de produção — defina CERT_ENCRYPTION_KEY para corrigir.'
      );
      return plaintext;
    }
    const motivo = error instanceof Error ? error.message : String(error);
    throw new Error(
      'Não foi possível criptografar o token para armazenamento: ' + motivo +
        ' Defina CERT_ENCRYPTION_KEY (mínimo de 32 caracteres). Nada foi gravado em texto puro.'
    );
  }
}

/**
 * Decrypt a sensitive token from storage.
 * Handles both encrypted ('ENC:...') and legacy plaintext formats.
 *
 * O formato plaintext continua sendo lido para não quebrar registros gravados
 * antes da correção — mas nada mais **produz** esse formato (ver `encryptToken`).
 */
export function decryptToken(stored: string | null | undefined): string | null {
  if (!stored) return null;

  // Not encrypted (legacy plaintext)
  if (!stored.startsWith(ENCRYPTED_PREFIX)) return stored;

  // Remove prefix and decrypt
  const encryptedData = stored.substring(ENCRYPTED_PREFIX.length);
  try {
    return decryptPassword(encryptedData);
  } catch (error) {
    // Devolver null (e não lançar) mantém o comportamento de quem chama: um
    // segredo ilegível é tratado como "não configurado", nunca como vazio válido.
    console.error('[TokenEncryption] Failed to decrypt token:', error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Check if a stored token is encrypted
 */
export function isTokenEncrypted(stored: string | null | undefined): boolean {
  return !!stored && stored.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Batch encrypt all sensitive fields for an office record
 */
export function encryptOfficeTokens(office: {
  mpAccessToken?: string | null;
  mpRefreshToken?: string | null;
  mpWebhookSecret?: string | null;
  waApiToken?: string | null;
  waWebhookSecret?: string | null;
}): {
  mpAccessToken?: string | null;
  mpRefreshToken?: string | null;
  mpWebhookSecret?: string | null;
  waApiToken?: string | null;
  waWebhookSecret?: string | null;
} {
  return {
    mpAccessToken: encryptToken(office.mpAccessToken),
    mpRefreshToken: encryptToken(office.mpRefreshToken),
    mpWebhookSecret: encryptToken(office.mpWebhookSecret),
    waApiToken: encryptToken(office.waApiToken),
    waWebhookSecret: encryptToken(office.waWebhookSecret),
  };
}

/**
 * Batch decrypt all sensitive fields for an office record
 */
export function decryptOfficeTokens(office: {
  mpAccessToken?: string | null;
  mpRefreshToken?: string | null;
  mpWebhookSecret?: string | null;
  waApiToken?: string | null;
  waWebhookSecret?: string | null;
}): {
  mpAccessToken: string | null;
  mpRefreshToken: string | null;
  mpWebhookSecret: string | null;
  waApiToken: string | null;
  waWebhookSecret: string | null;
} {
  return {
    mpAccessToken: decryptToken(office.mpAccessToken),
    mpRefreshToken: decryptToken(office.mpRefreshToken),
    mpWebhookSecret: decryptToken(office.mpWebhookSecret),
    waApiToken: decryptToken(office.waApiToken),
    waWebhookSecret: decryptToken(office.waWebhookSecret),
  };
}
