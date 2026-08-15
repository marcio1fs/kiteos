/**
 * Rate Limiting and Account Lockout Module
 *
 * SECURITY FIX: Prevents brute force attacks on authentication endpoints
 * and protects all API routes from abuse.
 *
 * Uses in-memory storage (suitable for single-instance deployment).
 * For multi-instance production, replace with Redis-backed store.
 */

import { getRedisClient } from './redis';

interface RateLimitEntry {
  count: number;
  resetAt: number;
  lockedUntil?: number;
}

// Rate limit store: key → { count, resetAt, lockedUntil }
const rateLimitStore = new Map<string, RateLimitEntry>();

// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now && (!entry.lockedUntil || entry.lockedUntil < now)) {
      rateLimitStore.delete(key);
    }
  }
}, 5 * 60 * 1000);

/**
 * Rate limit configuration per route type
 */
export const RATE_LIMITS = {
  // Auth endpoints — strict limits to prevent brute force
  LOGIN: { maxRequests: 5, windowMs: 15 * 60 * 1000 },       // 5 attempts per 15 min
  REGISTER: { maxRequests: 3, windowMs: 60 * 60 * 1000 },     // 3 registrations per hour

  // Account lockout — after too many failed attempts
  LOGIN_LOCKOUT: { maxAttempts: 10, lockoutMs: 30 * 60 * 1000 }, // 10 fails = 30 min lockout

  // API endpoints — moderate limits
  API_DEFAULT: { maxRequests: 100, windowMs: 60 * 1000 },     // 100 requests per minute
  API_WRITE: { maxRequests: 30, windowMs: 60 * 1000 },         // 30 write operations per minute

  // External API proxy — prevent abuse
  CONSULTA: { maxRequests: 20, windowMs: 60 * 1000 },          // 20 external queries per minute

  // AI chat — prevent cost abuse
  AI_CHAT: { maxRequests: 15, windowMs: 60 * 1000 },           // 15 AI requests per minute
} as const;

/**
 * Check if a request should be rate limited
 * Returns { allowed: boolean, retryAfterMs?: number }
 */
export function checkRateLimit(
  key: string,
  config: { maxRequests: number; windowMs: number }
): { allowed: boolean; retryAfterMs?: number; remaining: number } {
  const now = Date.now();
  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    // New window
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + config.windowMs,
    });
    return { allowed: true, remaining: config.maxRequests - 1 };
  }

  if (entry.count >= config.maxRequests) {
    // Rate limited
    return {
      allowed: false,
      retryAfterMs: entry.resetAt - now,
      remaining: 0,
    };
  }

  // Increment count
  entry.count++;
  return { allowed: true, remaining: config.maxRequests - entry.count };
}

/**
 * Check if an account is locked due to too many failed login attempts
 * Returns { locked: boolean, lockoutUntilMs?: number }
 */
export function checkAccountLockout(identifier: string): { locked: boolean; lockoutUntilMs?: number } {
  const key = `lockout:${identifier}`;
  const entry = rateLimitStore.get(key);

  if (!entry || !entry.lockedUntil) {
    return { locked: false };
  }

  if (entry.lockedUntil > Date.now()) {
    return { locked: true, lockoutUntilMs: entry.lockedUntil };
  }

  // Lockout expired, clean up
  rateLimitStore.delete(key);
  return { locked: false };
}

/**
 * Record a failed login attempt and lock account if threshold reached
 */
export function recordFailedLogin(identifier: string): { locked: boolean; attemptsRemaining: number } {
  const key = `lockout:${identifier}`;
  const config = RATE_LIMITS.LOGIN_LOCKOUT;
  const now = Date.now();

  const entry = rateLimitStore.get(key);

  if (!entry || entry.resetAt < now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + config.lockoutMs,
    });
    return { locked: false, attemptsRemaining: config.maxAttempts - 1 };
  }

  entry.count++;

  if (entry.count >= config.maxAttempts) {
    // Lock the account
    entry.lockedUntil = now + config.lockoutMs;
    return { locked: true, attemptsRemaining: 0 };
  }

  return { locked: false, attemptsRemaining: config.maxAttempts - entry.count };
}

/**
 * Clear lockout after successful login
 */
export function clearAccountLockout(identifier: string): void {
  const key = `lockout:${identifier}`;
  rateLimitStore.delete(key);
}

/**
 * Get client identifier for rate limiting
 * Uses IP address from headers (behind proxy) or from request
 */
export function getClientIdentifier(request: Request, suffix?: string): string {
  // Try forwarded headers first (behind reverse proxy)
  const forwarded = request.headers.get('x-forwarded-for');
  const realIp = request.headers.get('x-real-ip');

  const ip = realIp || (forwarded ? forwarded.split(',')[0].trim() : 'unknown');

  return suffix ? `${ip}:${suffix}` : ip;
}

/**
 * Async version of checkRateLimit using Redis (if configured)
 */
export async function checkRateLimitAsync(
  key: string,
  config: { maxRequests: number; windowMs: number }
): Promise<{ allowed: boolean; retryAfterMs?: number; remaining: number }> {
  const redis = getRedisClient();
  if (!redis) {
    // Fallback to in-memory
    return checkRateLimit(key, config);
  }
  
  // Redis-based implementation using INCR + PEXPIRE
  const redisKey = `ratelimit:${key}`;
  const windowSec = Math.ceil(config.windowMs / 1000);
  
  const current = await redis.incr(redisKey);
  if (current === 1) {
    await redis.expire(redisKey, windowSec);
  }
  
  if (current > config.maxRequests) {
    const ttl = await redis.pttl(redisKey);
    return { allowed: false, retryAfterMs: ttl > 0 ? ttl : config.windowMs, remaining: 0 };
  }
  
  return { allowed: true, remaining: config.maxRequests - current };
}

/**
 * Async version of checkAccountLockout using Redis
 */
export async function checkAccountLockoutAsync(identifier: string): Promise<{ locked: boolean; lockoutUntilMs?: number }> {
  const redis = getRedisClient();
  if (!redis) return checkAccountLockout(identifier);
  
  const key = `lockout:${identifier}`;
  const lockedUntil = await redis.get(key);
  
  if (!lockedUntil) return { locked: false };
  
  const lockoutMs = parseInt(lockedUntil, 10);
  if (lockoutMs > Date.now()) {
    return { locked: true, lockoutUntilMs: lockoutMs };
  }
  
  await redis.del(key);
  return { locked: false };
}

/**
 * Async version of recordFailedLogin using Redis
 */
export async function recordFailedLoginAsync(identifier: string): Promise<{ locked: boolean; attemptsRemaining: number }> {
  const redis = getRedisClient();
  if (!redis) return recordFailedLogin(identifier);
  
  const config = RATE_LIMITS.LOGIN_LOCKOUT;
  const key = `lockout_count:${identifier}`;
  const lockoutKey = `lockout:${identifier}`;
  const now = Date.now();
  
  // First check if already locked
  const lockedUntil = await redis.get(lockoutKey);
  if (lockedUntil && parseInt(lockedUntil, 10) > now) {
    return { locked: true, attemptsRemaining: 0 };
  }
  
  const windowSec = Math.ceil(config.lockoutMs / 1000);
  const current = await redis.incr(key);
  
  if (current === 1) {
    await redis.expire(key, windowSec);
  }
  
  if (current >= config.maxAttempts) {
    // Lock the account
    const lockoutTime = now + config.lockoutMs;
    await redis.set(lockoutKey, lockoutTime.toString(), 'PX', config.lockoutMs);
    await redis.del(key); // clear the count since it's locked
    return { locked: true, attemptsRemaining: 0 };
  }
  
  return { locked: false, attemptsRemaining: config.maxAttempts - current };
}

/**
 * Async version of clearAccountLockout using Redis
 */
export async function clearAccountLockoutAsync(identifier: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return clearAccountLockout(identifier);
  }
  
  await redis.del(`lockout:${identifier}`);
  await redis.del(`lockout_count:${identifier}`);
}
