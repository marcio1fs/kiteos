# Security Fixes: Refresh Token Rotation (#77) & Token Revocation/Blacklist (#78)

## Summary
Implemented two critical security features for the KiteOS ERP system:
1. **Refresh Token with Rotation (#77)** - Allows session extension without re-authentication, with automatic token rotation to prevent reuse
2. **Token Revocation/Blacklist (#78)** - Enables immediate invalidation of JWT tokens on logout, password change, or account deactivation

## Files Modified

### 1. `prisma/schema.prisma`
- Added `RefreshToken` model with fields: id, token (unique), userId, officeId, role, expiresAt, revokedAt, replacedBy, reason, createdAt, isRevoked
- Added `TokenBlacklist` model with fields: id, jti (unique), userId, officeId, reason, expiresAt, createdAt
- Added `refreshTokens RefreshToken[]` relation to `User` model
- Added `refreshTokens RefreshToken[]` relation to `Office` model
- Added indexes on [userId], [token], [expiresAt] for RefreshToken
- Added indexes on [jti], [expiresAt] for TokenBlacklist

### 2. `src/lib/auth.ts`
- **Removed** old in-memory blacklist implementation (Map-based, single-instance only)
- Added `generateRefreshToken()` - Creates a new refresh token, revokes existing ones (rotation)
- Added `rotateRefreshToken()` - Validates and rotates refresh tokens with theft detection
- Added `revokeRefreshToken()` - Revokes a specific refresh token (for logout)
- Added `revokeAllUserTokens()` - Revokes all tokens for a user (password change, deactivation)
- Added `addToTokenBlacklist()` - Adds a JWT to the database-backed blacklist
- Added `isTokenBlacklisted()` - Checks if a user has active blacklist entries
- Added `cleanupExpiredBlacklistEntries()` - Periodic cleanup of expired blacklist entries
- Added `cleanupExpiredRefreshTokens()` - Periodic cleanup of expired refresh tokens
- Updated `requireAuth()` to use async `isTokenBlacklisted()` instead of sync `isUserTokenBlacklisted()`

### 3. `src/app/api/auth/refresh/route.ts` (NEW)
- POST endpoint that exchanges a valid refresh token for a new JWT + new refresh token
- Implements rotation: old refresh token is invalidated after use
- Returns 401 if token is invalid, revoked, or reuse is detected

### 4. `src/app/api/auth/logout/route.ts` (NEW)
- POST endpoint that revokes refresh token and blacklists current JWT
- Requires authentication (goes through middleware)
- Logs logout event with IP and user agent

### 5. `src/app/api/auth/login/route.ts`
- Added import for `generateRefreshToken`
- Added refresh token generation after JWT token creation
- Added `refreshToken` to response data object
- Fixed `findUnique` → `findFirst` for user lookup (email alone not unique in schema)

### 6. `src/middleware.ts`
- Added `/api/auth/refresh` to `PUBLIC_ROUTES` (refresh token validated internally)

## Key Security Features

### Refresh Token Rotation (#77)
- 7-day refresh token expiry
- Automatic rotation on each use (old token invalidated)
- **Theft detection**: If a revoked token is reused, ALL user tokens are revoked and JWT is blacklisted
- Uses `crypto.randomUUID() + crypto.randomBytes(32)` for token generation

### Token Blacklist (#78)
- Database-backed blacklist (survives server restarts, unlike old in-memory implementation)
- Supports multiple revocation reasons: LOGOUT, PASSWORD_CHANGE, ACCOUNT_DEACTIVATED, SECURITY, TOKEN_THEFT_DETECTED
- Auto-cleanup based on JWT expiry (8h)
- Compatible with GDPR deletion flow (used in gdpr-delete route)

## Test Results
All integration tests passed:
- ✅ Login returns JWT + refresh token
- ✅ Refresh endpoint returns new JWT + new refresh token
- ✅ Old refresh token is rejected after rotation (reuse detection)
- ✅ Logout revokes refresh token and blacklists JWT
- ✅ ESLint passes with no errors
