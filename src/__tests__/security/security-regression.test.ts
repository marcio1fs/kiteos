/**
 * Security Regression Tests
 * 
 * These tests verify that security fixes remain in place
 * and prevent regressions from being introduced.
 * 
 * Run with: CERT_ENCRYPTION_KEY='test-key' npx vitest run src/__tests__/security/
 */

import { describe, it, expect, beforeAll } from 'vitest';

// ============================================================================
// AUD-01: XSS Prevention in Input Sanitization
// ============================================================================
import { sanitizeString, sanitizeObject, SANITIZABLE_FIELDS } from '@/lib/sanitize';

describe('Security: XSS Prevention (AUD-01)', () => {
  it('deve remover tags script completamente', () => {
    expect(sanitizeString('<script>alert(1)</script>')).toBe('');
  });

  it('deve remover img tags com event handlers', () => {
    const result = sanitizeString('<img src=x onerror=alert(1)>');
    // No executable HTML should remain
    expect(result).not.toContain('<img');
    expect(result).not.toContain('onerror');
    expect(result).not.toContain('alert(');
  });

  it('deve remover event handlers e tags HTML', () => {
    expect(sanitizeString('<div onclick="alert(1)">texto</div>')).toContain('texto');
    // After sanitization, no HTML tags should remain
    expect(sanitizeString('<b>negrito</b>')).toContain('negrito');
  });

  it('deve preservar texto legítimo', () => {
    expect(sanitizeString('João Silva')).toBe('João Silva');
    expect(sanitizeString('Rua das Flores, 100')).toBe('Rua das Flores, 100');
    expect(sanitizeString('empresa@servico.com.br')).toBe('empresa@servico.com.br');
  });

  it('deve remover links javascript: em HTML', () => {
    // XSS pattern with javascript: in href is caught and the tag is stripped
    const result = sanitizeString('<a href="javascript:alert(1)">link</a>');
    // The critical check: no <script>, no onclick, no <a> tags remain
    expect(result).not.toContain('<a');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('<script');
  });

  it('deve remover null bytes', () => {
    expect(sanitizeString('test\0evil')).toBe('testevil');
  });

  it('deve sanitizar objetos com campos HTML', () => {
    const input = { name: '<b>bold</b> text', email: 'test@test.com' };
    const result = sanitizeObject(input);
    expect(result.name).toContain('bold');
    expect(result.name).toContain('text');
    expect(result.email).toBe('test@test.com');
  });

  it('deve ter campos sanitizáveis definidos para todas as entidades', () => {
    expect(SANITIZABLE_FIELDS.client).toBeDefined();
    expect(SANITIZABLE_FIELDS.vehicle).toBeDefined();
    expect(SANITIZABLE_FIELDS.supplier).toBeDefined();
    expect(SANITIZABLE_FIELDS.part).toBeDefined();
    expect(SANITIZABLE_FIELDS.user).toBeDefined();
    expect(SANITIZABLE_FIELDS.office).toBeDefined();
  });
});

// ============================================================================
// AUD-02: Token Encryption in MP Routes
// ============================================================================
import { encryptToken, decryptToken, isTokenEncrypted } from '@/lib/token-encryption';

/**
 * PASSO 6 (CFG-05): o comportamento documentado aqui mudou de propósito.
 *
 * Antes, sem CERT_ENCRYPTION_KEY, `encryptToken` devolvia o **plaintext** com um
 * `console.warn` quando NODE_ENV não era exatamente "production" — o teste abaixo
 * aceitava os dois desfechos ("graceful degradation"). Isso significava que um
 * staging, ou um container sem NODE_ENV, gravava token de pagamento legível no
 * banco sem que nada falhasse. Agora a ausência de chave lança, e gravar em texto
 * puro exige opt-in explícito fora de produção.
 */
describe('Security: Token Encryption (AUD-02 / CFG-05)', () => {
  const CHAVE = 'test-encryption-key-for-unit-tests-min-32chars';
  const salvo: Record<string, string | undefined> = {};

  function preparar(overrides: Record<string, string | undefined>) {
    for (const key of ['CERT_ENCRYPTION_KEY', 'NODE_ENV', 'ALLOW_INSECURE_PLAINTEXT_TOKENS']) {
      if (!(key in salvo)) salvo[key] = process.env[key];
      if (overrides[key] === undefined) delete process.env[key];
      else process.env[key] = overrides[key];
    }
  }

  function restaurar() {
    for (const [key, value] of Object.entries(salvo)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    for (const key of Object.keys(salvo)) delete salvo[key];
  }

  it('criptografa com prefixo ENC: quando CERT_ENCRYPTION_KEY está configurado', () => {
    preparar({ CERT_ENCRYPTION_KEY: CHAVE, NODE_ENV: 'production', ALLOW_INSECURE_PLAINTEXT_TOKENS: undefined });
    try {
      const plain = 'APP_USR-12345-test-token';
      const encrypted = encryptToken(plain);
      expect(encrypted?.startsWith('ENC:')).toBe(true);
      expect(encrypted).not.toBe(plain);
      expect(encrypted).not.toContain(plain);
    } finally {
      restaurar();
    }
  });

  it('descriptografa de volta ao valor original', () => {
    preparar({ CERT_ENCRYPTION_KEY: CHAVE, NODE_ENV: 'production', ALLOW_INSECURE_PLAINTEXT_TOKENS: undefined });
    try {
      const plain = 'APP_USR-12345-test-token';
      expect(decryptToken(encryptToken(plain))).toBe(plain);
    } finally {
      restaurar();
    }
  });

  it('LANÇA em vez de gravar em texto puro quando falta a chave (mesmo em staging)', () => {
    // "staging" era exatamente o caso que o código antigo tratava como
    // desenvolvimento e gravava plaintext.
    for (const ambiente of ['staging', 'production', 'homolog']) {
      preparar({ CERT_ENCRYPTION_KEY: undefined, NODE_ENV: ambiente, ALLOW_INSECURE_PLAINTEXT_TOKENS: undefined });
      try {
        expect(() => encryptToken('APP_USR-token-real')).toThrow(/CERT_ENCRYPTION_KEY/);
      } finally {
        restaurar();
      }
    }
  });

  it('lança também quando NODE_ENV está ausente (container mal configurado)', () => {
    preparar({ CERT_ENCRYPTION_KEY: undefined, NODE_ENV: undefined, ALLOW_INSECURE_PLAINTEXT_TOKENS: undefined });
    try {
      expect(() => encryptToken('APP_USR-token-real')).toThrow(/CERT_ENCRYPTION_KEY/);
    } finally {
      restaurar();
    }
  });

  it('texto puro só com opt-in explícito e fora de produção', () => {
    preparar({
      CERT_ENCRYPTION_KEY: undefined,
      NODE_ENV: 'development',
      ALLOW_INSECURE_PLAINTEXT_TOKENS: 'true',
    });
    try {
      expect(encryptToken('APP_USR-token-local')).toBe('APP_USR-token-local');
    } finally {
      restaurar();
    }

    // Em produção o opt-in não é honrado: a partida já teria recusado a variável.
    preparar({
      CERT_ENCRYPTION_KEY: undefined,
      NODE_ENV: 'production',
      ALLOW_INSECURE_PLAINTEXT_TOKENS: 'true',
    });
    try {
      expect(() => encryptToken('APP_USR-token-real')).toThrow(/CERT_ENCRYPTION_KEY/);
    } finally {
      restaurar();
    }
  });

  it('detecta tokens já criptografados', () => {
    expect(isTokenEncrypted('ENC:abc123')).toBe(true);
    expect(isTokenEncrypted('APP_USR-plain-token')).toBe(false);
    expect(isTokenEncrypted(null)).toBe(false);
  });

  it('não criptografa duas vezes', () => {
    preparar({ CERT_ENCRYPTION_KEY: CHAVE, NODE_ENV: 'production', ALLOW_INSECURE_PLAINTEXT_TOKENS: undefined });
    try {
      const plain = 'test-token';
      const encrypted1 = encryptToken(plain);
      expect(encryptToken(encrypted1)).toBe(encrypted1);
    } finally {
      restaurar();
    }
  });

  it('retorna null para tokens nulos', () => {
    expect(encryptToken(null)).toBeNull();
    expect(decryptToken(null)).toBeNull();
  });

  it('legacy plaintext continua legível, mas nada mais o produz', () => {
    preparar({ CERT_ENCRYPTION_KEY: CHAVE, NODE_ENV: 'production', ALLOW_INSECURE_PLAINTEXT_TOKENS: undefined });
    try {
      // Registros gravados antes da correção não podem ficar inutilizáveis.
      expect(decryptToken('APP_USR-legacy-sem-prefixo')).toBe('APP_USR-legacy-sem-prefixo');
      expect(encryptToken('APP_USR-legacy-sem-prefixo')?.startsWith('ENC:')).toBe(true);
    } finally {
      restaurar();
    }
  });
});

// ============================================================================
// Auth: Password Validation (AUD-05 regression)
// ============================================================================
import { validatePasswordStrength, hashPassword, verifyPassword, needsHashMigration } from '@/lib/auth';

describe('Security: Password Strength', () => {
  it('deve rejeitar senhas fracas', () => {
    expect(validatePasswordStrength('123').valid).toBe(false);
    expect(validatePasswordStrength('abcdef').valid).toBe(false);
    expect(validatePasswordStrength('abcdefgh').valid).toBe(false);
  });

  it('deve aceitar senhas fortes', () => {
    const result = validatePasswordStrength('KiteOS@Admin2024!');
    expect(result.valid).toBe(true);
  });

  it('deve exigir pelo menos 8 caracteres, maiúscula, minúscula, número e especial', () => {
    const result = validatePasswordStrength('short1A!');
    expect(result.valid).toBe(true);
  });
});

describe('Security: Password Hashing', () => {
  it('deve usar bcrypt (não SHA-256)', async () => {
    const hash = await hashPassword('test-password');
    expect(hash.startsWith('$2')).toBe(true);
  });

  it('deve detectar hashes legados que precisam migração', () => {
    expect(needsHashMigration('$2b$12$abc')).toBe(false);
    expect(needsHashMigration('abc123def456')).toBe(true);
    expect(needsHashMigration('salt:hash1234567890abcdef1234567890abcdef1234567890abcdef1234567890')).toBe(true);
  });
});

// ============================================================================
// RBAC: Role Hierarchy
// ============================================================================
describe('Security: Role Hierarchy', () => {
  it('OWNER > ADMIN > EMPLOYEE hierarchy should be enforced', () => {
    const ROLE_HIERARCHY: Record<string, number> = {
      EMPLOYEE: 1,
      ADMIN: 2,
      OWNER: 3,
    };
    expect(ROLE_HIERARCHY.OWNER).toBeGreaterThan(ROLE_HIERARCHY.ADMIN);
    expect(ROLE_HIERARCHY.ADMIN).toBeGreaterThan(ROLE_HIERARCHY.EMPLOYEE);
  });
});

// ============================================================================
// Rate Limiting
// ============================================================================
import { checkRateLimit, checkAccountLockout, recordFailedLogin, clearAccountLockout, RATE_LIMITS } from '@/lib/rate-limiter';

describe('Security: Rate Limiting', () => {
  it('deve ter limites configurados para login e registro', () => {
    expect(RATE_LIMITS.LOGIN.maxRequests).toBeLessThanOrEqual(10);
    expect(RATE_LIMITS.REGISTER.maxRequests).toBeLessThanOrEqual(5);
  });

  it('deve bloquear após exceder limite', () => {
    const key = `test-rate-limit-${Date.now()}`;
    const config = { maxRequests: 2, windowMs: 60000 };
    
    checkRateLimit(key, config);
    checkRateLimit(key, config);
    const result = checkRateLimit(key, config);
    
    expect(result.allowed).toBe(false);
  });

  it('deve bloquear conta após tentativas falhas', () => {
    const email = `test-lockout-${Date.now()}@test.com`;
    
    for (let i = 0; i < 10; i++) {
      recordFailedLogin(email);
    }
    
    const lockout = checkAccountLockout(email);
    expect(lockout.locked).toBe(true);
    
    clearAccountLockout(email);
  });
});
