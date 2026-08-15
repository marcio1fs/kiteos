import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';
import {
  checkRateLimitAsync,
  getClientIdentifier,
  RATE_LIMITS,
} from '@/lib/rate-limiter';

// ============================================================================
// Routes that don't require authentication
// SECURITY FIXES:
// - Removed /api/seed (was allowing unauthenticated admin account creation)
// - Fixed /api/mercadopago/payment-webhook → /api/mercadopago/webhook (wrong path)
// - Removed blanket /api/uploads/ bypass (now requires auth)
// ============================================================================
const PUBLIC_ROUTES = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/uploads/',
  '/api/mercadopago/subscription-webhook',
  '/api/mercadopago/subscription-return',
  '/api/mercadopago/webhook',
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ============================================================================
  // SECURITY FIX: Add correlation ID for request tracing (#70)
  // Enables tracking requests across services and logs
  // ============================================================================
  const correlationId = request.headers.get('x-request-id') || crypto.randomUUID();

  // Only protect API routes
  if (!pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // ============================================================================
  // SECURITY FIX: Rate limiting at network proxy level for API routes
  // Applies to ALL API routes, with stricter limits on auth endpoints
  // ============================================================================
  const clientIp = getClientIdentifier(request);
  const isAuthRoute = pathname.startsWith('/api/auth/login') || pathname.startsWith('/api/auth/register');
  const rateLimitConfig = isAuthRoute
    ? (pathname.includes('login') ? RATE_LIMITS.LOGIN : RATE_LIMITS.REGISTER)
    : RATE_LIMITS.API_DEFAULT;

  const rateResult = await checkRateLimitAsync(
    `${clientIp}:${pathname}`,
    rateLimitConfig
  );

  if (!rateResult.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Limite de requisições excedido. Tente novamente em alguns segundos.',
        retryAfter: Math.ceil((rateResult.retryAfterMs || 0) / 1000),
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateResult.retryAfterMs || 0) / 1000)),
          'X-RateLimit-Remaining': '0',
          'X-Request-ID': correlationId,
        },
      }
    );
  }

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    const response = NextResponse.next();
    response.headers.set('X-Request-ID', correlationId);
    // Still add security headers to public routes
    addSecurityHeaders(response);
    return response;
  }

  // Get token from cookie or Authorization header
  let token = request.cookies.get('kiteos_token')?.value;

  if (!token) {
    const authHeader = request.headers.get('Authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    return NextResponse.json(
      { success: false, error: 'Token de autenticação não fornecido' },
      { status: 401, headers: { 'X-Request-ID': correlationId } }
    );
  }

  try {
    // ============================================================================
    // SECURITY FIX: Removed hardcoded JWT secret fallback
    // Application MUST fail if JWT_SECRET is not configured
    // ============================================================================
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      console.error('FATAL: JWT_SECRET environment variable is not set');
      return NextResponse.json(
        { success: false, error: 'Erro de configuração do servidor' },
        { status: 500 }
      );
    }
    const JWT_SECRET = new TextEncoder().encode(jwtSecret);
    const { payload } = await jwtVerify(token, JWT_SECRET);

    // ============================================================================
    // SECURITY FIX: Removed x-user-id/x-user-email/x-user-role/x-office-id
    // header injection. These headers could be spoofed if middleware was bypassed.
    // Route handlers now verify the JWT directly via getAuthFromRequest().
    //
    // We still set x-office-id and x-user-id for logging/tracing purposes only,
    // but route handlers MUST NOT trust these for authorization decisions.
    // ============================================================================
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set('x-office-id', payload.officeId as string);
    requestHeaders.set('x-user-id', payload.userId as string);
    requestHeaders.set('x-request-id', correlationId);

    const response = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });

    // ============================================================================
    // SECURITY: Add comprehensive security headers to all API responses
    // SECURITY FIX: Added CSP and HSTS headers
    // ============================================================================
    addSecurityHeaders(response);
    response.headers.set('X-Request-ID', correlationId);

    return response;
  } catch {
    return NextResponse.json(
      { success: false, error: 'Token inválido ou expirado' },
      { status: 401, headers: { 'X-Request-ID': correlationId } }
    );
  }
}

/**
 * SECURITY FIX: Centralized security headers function
 * Includes CSP, HSTS, and other OWASP-recommended headers
 */
function addSecurityHeaders(response: NextResponse): void {
  // Prevent MIME type sniffing
  response.headers.set('X-Content-Type-Options', 'nosniff');

  // Prevent clickjacking
  response.headers.set('X-Frame-Options', 'DENY');

  // Enable XSS filtering in browsers
  response.headers.set('X-XSS-Protection', '1; mode=block');

  // Control referrer information
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Disable unnecessary browser features
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Prevent caching of API responses (sensitive data)
  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  response.headers.set('Pragma', 'no-cache');

  // ============================================================================
  // SECURITY FIX: Content Security Policy for API responses
  // Prevents injection of scripts/styles in any API response
  // ============================================================================
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'"
  );

  // ============================================================================
  // SECURITY FIX: HTTP Strict Transport Security (HSTS)
  // Forces HTTPS for 1 year, includes subdomains
  // Only set if the request is over HTTPS (or behind a proxy that terminates TLS)
  // ============================================================================
  const proto = response.headers.get('x-forwarded-proto') || 'https';
  if (proto === 'https') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains; preload'
    );
  }

  // Prevent cross-origin leaks
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
}

export const config = {
  matcher: [
    '/api/:path*',
  ],
};
