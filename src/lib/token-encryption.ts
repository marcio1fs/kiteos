/**
 * Token Encryption Module
 * 
 * SECURITY FIX (#79): Encrypts sensitive tokens (API keys, secrets) at rest
 * Uses the same AES-256-GCM encryption as certificate.ts for consistency
 * 
 * Tokens encrypted: mpAccessToken, mpRefreshToken, mpWebhookSecret, waApiToken, waWebhookSecret
 */

import { encryptPassword, decryptPassword } from '@/lib/sefaz/certificate';

// Prefix to identify encrypted tokens (vs plaintext legacy tokens)
const ENCRYPTED_PREFIX = 'ENC:';

/**
 * Encrypt a sensitive token for storage
 * Returns 'ENC:<encrypted_data>' format
 * 
 * If encryption fails (e.g., CERT_ENCRYPTION_KEY not set), returns the plaintext token
 * with a warning — this allows the system to continue working in development
 */
export function encryptToken(plaintext: string | null | undefined): string | null {
  if (!plaintext) return null;
  
  // Already encrypted — don't double-encrypt
  if (plaintext.startsWith(ENCRYPTED_PREFIX)) return plaintext;
  
  try {
    const encrypted = encryptPassword(plaintext);
    return `${ENCRYPTED_PREFIX}${encrypted}`;
  } catch (error) {
    if (process.env.NODE_ENV === 'production') {
      throw error;
    }
    console.warn('[TokenEncryption] Failed to encrypt token - CERT_ENCRYPTION_KEY may not be set. Storing as plaintext.');
    return plaintext;
  }
}

/**
 * Decrypt a sensitive token from storage
 * Handles both encrypted ('ENC:...') and legacy plaintext formats
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
    console.error('[TokenEncryption] Failed to decrypt token:', error);
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
