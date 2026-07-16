# Security Fixes Implementation - Token Encryption (#79) & Correlation ID + Structured Logging (#70)

## Summary

Implemented two security features for the KiteOS ERP system:

### 1. Encrypt Sensitive Tokens at Rest (#79)

**New File: `/src/lib/token-encryption.ts`**
- Provides `encryptToken()` and `decryptToken()` functions using the existing AES-256-GCM encryption from `certificate.ts`
- Uses `ENC:` prefix to identify encrypted tokens vs legacy plaintext
- Backward-compatible: plaintext tokens still work for reading (no migration needed)
- Batch operations: `encryptOfficeTokens()` and `decryptOfficeTokens()`
- Graceful fallback if `CERT_ENCRYPTION_KEY` not set (warns and stores plaintext)

**Modified: `/src/app/api/mercadopago/config/route.ts`**
- Added `encryptToken` import
- In PUT handler: `mpAccessToken` and `mpWebhookSecret` are encrypted before database storage

**Modified: `/src/app/api/mercadopago/webhook/route.ts`**
- Added `decryptToken` import
- In POST handler: tokens are decrypted before validation and API calls
- Replaced `office.mpAccessToken` with `decryptedAccessToken`
- Replaced `office.mpWebhookSecret` with `decryptedWebhookSecret`

**Modified: `/src/app/api/mercadopago/subscription-webhook/route.ts`**
- Added `decryptToken` import
- In POST handler: tokens are decrypted before validation and API calls
- Same pattern as webhook route

### 2. Correlation ID + Structured Logging (#70)

**New File: `/src/lib/logger.ts`**
- Structured JSON logger with `debug`, `info`, `warn`, `error` levels
- Automatic sensitive data redaction (passwords, tokens, CPF, CNPJ, etc.)
- Includes correlation ID, user ID, office ID support
- Max depth protection for nested objects

**Modified: `/src/middleware.ts`**
- Added `correlationId` generation using `crypto.randomUUID()` at the start
- Correlation ID propagated as `X-Request-ID` header on:
  - 429 rate-limited responses
  - Public route responses
  - 401 unauthorized responses (both "no token" and "invalid token")
  - Authenticated route responses
  - Forwarded as `x-request-id` request header for downstream handlers

## Verification
- `bun run lint` passes with no errors
- Dev server running without errors
