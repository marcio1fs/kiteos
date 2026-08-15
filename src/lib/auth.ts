import { SignJWT, jwtVerify } from 'jose';
import { db } from '@/lib/db';
import crypto from 'crypto';

// ============================================================================
// SECURITY FIX: Removed hardcoded JWT secret fallback
// The application MUST fail to start if JWT_SECRET is not configured
// ============================================================================
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('FATAL: JWT_SECRET environment variable is not set. Refusing to start with insecure default.');
  }
  if (secret.length < 32) {
    throw new Error('FATAL: JWT_SECRET must be at least 32 characters long.');
  }
  return new TextEncoder().encode(secret);
}

let _jwtSecret: Uint8Array | null = null;
function getSecret(): Uint8Array {
  if (!_jwtSecret) _jwtSecret = getJwtSecret();
  return _jwtSecret;
}

export interface TokenPayload {
  userId: string;
  role: string;
  officeId: string;
  iat?: number;
  exp?: number;
  // SECURITY FIX: Removed email from JWT payload (PII exposure)
  // Email can be fetched from DB via /api/auth/me when needed
}

// ============================================================================
// SECURITY FIX: Reduced JWT expiry from 24h to 8h
// Combined with lack of token revocation, shorter expiry limits attack window
// ============================================================================
export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('8h')
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<TokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as TokenPayload;
  } catch {
    return null;
  }
}

// ============================================================================
// SECURITY FIX: Replaced SHA-256 with bcrypt for password hashing
// SHA-256 is a fast hash — GPUs can compute billions per second
// bcrypt with cost 12 takes ~250ms per hash, making brute force impractical
// ============================================================================
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Modern bcrypt hash (starts with $2b$ or $2a$)
  if (storedHash.startsWith('$2')) {
    return bcrypt.compare(password, storedHash);
  }

  // Legacy salted SHA-256 format (salt:hash) — auto-migrate on successful login
  if (storedHash.includes(':') && storedHash.split(':').length === 2 && storedHash.split(':')[1].length === 64) {
    const [salt, hash] = storedHash.split(':');
    const legacyHash = crypto.createHash('sha256').update(salt + password).digest('hex');
    if (legacyHash === hash) {
      // Auto-upgrade to bcrypt — will be saved by the login route
      return true;
    }
    return false;
  }

  // Legacy unsalted SHA-256 — auto-migrate on successful login
  if (storedHash.length === 64 && /^[a-f0-9]+$/.test(storedHash)) {
    const legacyHash = crypto.createHash('sha256').update(password).digest('hex');
    if (legacyHash === storedHash) {
      return true;
    }
    return false;
  }

  // Try bcrypt as fallback
  try {
    return await bcrypt.compare(password, storedHash);
  } catch {
    return false;
  }
}

/**
 * Check if a password hash needs migration from legacy SHA-256 to bcrypt
 */
export function needsHashMigration(storedHash: string): boolean {
  return !storedHash.startsWith('$2');
}

export function getTokenFromHeaders(headers: Headers): string | null {
  const auth = headers.get('Authorization');
  if (!auth) return null;
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return auth;
}

export function getTokenFromCookies(cookies: string | null): string | null {
  if (!cookies) return null;
  const match = cookies.match(/(?:^|;\s*)kiteos_token=([^;]*)/);
  return match ? match[1] : null;
}

// ============================================================================
// SECURITY FIX: Removed header-injection trust pattern
// Previously, x-user-id/x-user-email/x-user-role/x-office-id headers
// set by middleware were trusted directly — allowing auth bypass if
// middleware was circumvented (direct server access, misconfigured proxy)
// Now ALWAYS verifies the JWT token directly
// ============================================================================
export async function getAuthFromRequest(request: Request): Promise<TokenPayload | null> {
  // Try to get token from cookies first, fallback to header
  let token = null;
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    token = getTokenFromCookies(cookieHeader);
  }
  
  if (!token) {
    token = getTokenFromHeaders(request.headers);
  }
  
  if (!token) return null;
  return await verifyToken(token);
}

/**
 * Role hierarchy for RBAC
 */
type UserRole = 'OWNER' | 'ADMIN' | 'EMPLOYEE';

const ROLE_HIERARCHY: Record<string, number> = {
  EMPLOYEE: 1,
  ADMIN: 2,
  OWNER: 3,
};

/**
 * Verify that the authenticated user has access to the specified officeId.
 * Optionally check minimum role requirement.
 * Returns the token payload if authorized, error object otherwise.
 */
export async function requireAuth(
  request: Request,
  requiredOfficeId?: string,
  minimumRole?: UserRole
): Promise<{ payload: TokenPayload; error?: never } | { payload: null; error: { status: number; message: string } }> {
  const payload = await getAuthFromRequest(request);

  if (!payload) {
    return { payload: null, error: { status: 401, message: 'Token inválido ou expirado' } };
  }

  // SECURITY FIX: Check token blacklist (for GDPR deletion / session revocation)
  if (await isTokenBlacklisted(payload.userId, payload.iat)) {
    return { payload: null, error: { status: 401, message: 'Sessão revogada. Faça login novamente.' } };
  }

  if (requiredOfficeId && payload.officeId !== requiredOfficeId) {
    return { payload: null, error: { status: 403, message: 'Acesso negado a este escritório' } };
  }

  // SECURITY FIX: Role-based access control
  if (minimumRole) {
    const userLevel = ROLE_HIERARCHY[payload.role] || 0;
    const requiredLevel = ROLE_HIERARCHY[minimumRole] || 0;
    if (userLevel < requiredLevel) {
      return { payload: null, error: { status: 403, message: 'Permissão insuficiente' } };
    }
  }

  return { payload };
}

/**
 * Password strength validation
 */
export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < 6) errors.push('Senha deve ter no mínimo 6 caracteres');
  if (!/[a-zA-Z]/.test(password)) errors.push('Senha deve conter ao menos uma letra');
  if (!/[0-9]/.test(password)) errors.push('Senha deve conter ao menos um número');
  return { valid: errors.length === 0, errors };
}

// ============================================================================
// SECURITY FIX: Refresh Token mechanism with rotation (#77)
// Prevents token reuse and supports secure session extension
// ============================================================================

const REFRESH_TOKEN_EXPIRY_DAYS = 7;

export interface RefreshTokenPayload {
  userId: string;
  role: string;
  officeId: string;
}

/**
 * Generate a new refresh token and store it in the database
 * Implements rotation: if an old refresh token exists for this user, it gets replaced
 */
export async function generateRefreshToken(
  userId: string,
  role: string,
  officeId: string
): Promise<string> {
  const token = crypto.randomUUID() + '-' + crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  // Revoke any existing refresh tokens for this user (rotation)
  await db.refreshToken.updateMany({
    where: {
      userId,
      isRevoked: false,
      expiresAt: { gt: new Date() },
    },
    data: { isRevoked: true, revokedAt: new Date(), reason: 'ROTATION' },
  });

  await db.refreshToken.create({
    data: {
      token,
      userId,
      officeId,
      role,
      expiresAt,
    },
  });

  return token;
}

/**
 * Validate and rotate a refresh token
 * Returns new JWT + new refresh token, or null if invalid
 */
export async function rotateRefreshToken(
  oldToken: string
): Promise<{
  token: string;
  refreshToken: string;
  payload: TokenPayload;
} | null> {
  const storedToken = await db.refreshToken.findUnique({
    where: { token: oldToken },
  });

  if (!storedToken) return null;

  // Check if token is revoked (reuse detection)
  if (storedToken.isRevoked) {
    // SECURITY: If a revoked token is being used, it means theft detected
    // Revoke ALL tokens for this user
    await db.refreshToken.updateMany({
      where: { userId: storedToken.userId, isRevoked: false },
      data: { isRevoked: true, revokedAt: new Date(), reason: 'TOKEN_THEFT_DETECTED' },
    });

    // Blacklist the user's current JWT
    await addToTokenBlacklist(storedToken.userId, storedToken.officeId, 'TOKEN_THEFT_DETECTED');

    await auditLog({
      action: 'REFRESH_TOKEN_REUSE_DETECTED',
      entity: 'RefreshToken',
      entityId: storedToken.id,
      details: 'Possible token theft - all sessions revoked',
      userId: storedToken.userId,
      officeId: storedToken.officeId,
    });

    return null;
  }

  // Check if token is expired
  if (storedToken.expiresAt < new Date()) {
    await db.refreshToken.update({
      where: { id: storedToken.id },
      data: { isRevoked: true, revokedAt: new Date(), reason: 'EXPIRED' },
    });
    return null;
  }

  // Rotate: mark old token as replaced
  const newRefreshToken = crypto.randomUUID() + '-' + crypto.randomBytes(32).toString('hex');
  const newExpiresAt = new Date();
  newExpiresAt.setDate(newExpiresAt.getDate() + REFRESH_TOKEN_EXPIRY_DAYS);

  await db.refreshToken.update({
    where: { id: storedToken.id },
    data: {
      isRevoked: true,
      revokedAt: new Date(),
      replacedBy: newRefreshToken,
      reason: 'ROTATION',
    },
  });

  // Create new refresh token
  await db.refreshToken.create({
    data: {
      token: newRefreshToken,
      userId: storedToken.userId,
      officeId: storedToken.officeId,
      role: storedToken.role,
      expiresAt: newExpiresAt,
    },
  });

  // Generate new JWT
  const payload: TokenPayload = {
    userId: storedToken.userId,
    role: storedToken.role,
    officeId: storedToken.officeId,
  };

  const jwtToken = await signToken(payload);

  return {
    token: jwtToken,
    refreshToken: newRefreshToken,
    payload,
  };
}

/**
 * Revoke a specific refresh token (used during logout)
 */
export async function revokeRefreshToken(token: string): Promise<boolean> {
  const storedToken = await db.refreshToken.findUnique({
    where: { token },
  });

  if (!storedToken) return false;

  await db.refreshToken.update({
    where: { id: storedToken.id },
    data: { isRevoked: true, revokedAt: new Date(), reason: 'LOGOUT' },
  });

  return true;
}

/**
 * Revoke all refresh tokens for a user (used during password change, account deactivation)
 */
export async function revokeAllUserTokens(userId: string): Promise<number> {
  const result = await db.refreshToken.updateMany({
    where: { userId, isRevoked: false },
    data: { isRevoked: true, revokedAt: new Date(), reason: 'REVOKE_ALL' },
  });
  return result.count;
}

// ============================================================================
// SECURITY FIX: Token Revocation Blacklist (#78)
// Allows immediate invalidation of JWT tokens on logout, password change, etc.
// ============================================================================

/**
 * Add a JWT token to the blacklist
 * Uses the token's iat (issued-at) and exp claims as a unique identifier
 */
export async function addToTokenBlacklist(
  userId: string,
  officeId: string,
  reason: string
): Promise<void> {
  // Create a blacklist entry that covers the user's current session
  // Since we can't decode the JWT here (already verified), we use userId + timestamp
  const jti = `${userId}:${Date.now()}`;
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 8); // Match JWT expiry

  await db.tokenBlacklist.create({
    data: {
      jti,
      userId,
      officeId,
      reason,
      expiresAt,
    },
  });
}

/**
 * Check if a user has any active blacklist entries
 * If so, their token should be rejected
 */
export async function isTokenBlacklisted(
  userId: string,
  tokenIssuedAt?: number
): Promise<boolean> {
  // Check if there are any blacklist entries for this user
  // that were created AFTER the token was issued
  const blacklisted = await db.tokenBlacklist.findFirst({
    where: {
      userId,
      ...(tokenIssuedAt
        ? { createdAt: { gt: new Date(tokenIssuedAt * 1000) } }
        : {}),
      expiresAt: { gt: new Date() },
    },
  });
  return !!blacklisted;
}

/**
 * Clean up expired blacklist entries (called periodically)
 */
export async function cleanupExpiredBlacklistEntries(): Promise<number> {
  const result = await db.tokenBlacklist.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}

/**
 * Clean up expired refresh tokens (called periodically)
 */
export async function cleanupExpiredRefreshTokens(): Promise<number> {
  const result = await db.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { isRevoked: true, revokedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      ],
    },
  });
  return result.count;
}

// ============================================================================
// SECURITY FIX: Enhanced audit log with IP, user agent, and change tracking
// ============================================================================
export async function auditLog(params: {
  action: string;
  entity: string;
  entityId?: string;
  details?: string;
  userId?: string;
  officeId: string;
  invoiceId?: string;
  oldValues?: string;
  newValues?: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  try {
    await db.auditLog.create({
      data: {
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        details: params.details,
        userId: params.userId,
        officeId: params.officeId,
        invoiceId: params.invoiceId,
        oldValues: params.oldValues,
        newValues: params.newValues,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  } catch (error) {
    console.error('Audit log error:', error);
  }
}
