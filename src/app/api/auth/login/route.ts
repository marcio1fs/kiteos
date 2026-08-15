import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { signToken, verifyPassword, hashPassword, needsHashMigration, auditLog, generateRefreshToken } from '@/lib/auth';
import {
  checkRateLimit,
  checkAccountLockout,
  recordFailedLogin,
  clearAccountLockout,
  getClientIdentifier,
  RATE_LIMITS,
} from '@/lib/rate-limiter';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: 'Email e senha são obrigatórios' },
        { status: 400 }
      );
    }

    // ============================================================================
    // SECURITY FIX: Rate limiting on login attempts
    // Prevents brute force attacks — 5 attempts per 15 minutes per IP
    // ============================================================================
    const clientIp = getClientIdentifier(request, 'login');
    const rateCheck = checkRateLimit(clientIp, RATE_LIMITS.LOGIN);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Muitas tentativas de login. Tente novamente em alguns minutos.',
          retryAfter: Math.ceil((rateCheck.retryAfterMs || 0) / 1000),
        },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rateCheck.retryAfterMs || 0) / 1000)) } }
      );
    }

    // ============================================================================
    // SECURITY FIX: Account lockout after too many failed attempts
    // Prevents targeted brute force on a specific email
    // ============================================================================
    const lockoutCheck = checkAccountLockout(email.toLowerCase());
    if (lockoutCheck.locked) {
      const remainingMs = (lockoutCheck.lockoutUntilMs || 0) - Date.now();
      return NextResponse.json(
        {
          success: false,
          error: `Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em ${Math.ceil(remainingMs / 60000)} minutos.`,
        },
        { status: 423 }
      );
    }

    const user = await db.user.findFirst({
      where: { email: email.toLowerCase(), deleted: false },
      include: { office: true },
    });

    // ============================================================================
    // SECURITY FIX: Generic error message to prevent user enumeration
    // Both "user not found" and "wrong password" return the same message
    // ============================================================================
    if (!user || user.deleted || !user.active) {
      // Still record failed login attempt for the email to prevent enumeration
      if (email) recordFailedLogin(email.toLowerCase());
      return NextResponse.json(
        { success: false, error: 'Credenciais inválidas' },
        { status: 401 }
      );
    }

    // ============================================================================
    // SECURITY FIX: Added missing `await` on verifyPassword — was ALWAYS truthy
    // (Promise object), allowing ANY password to authenticate. CRITICAL BYPASS.
    // ============================================================================
    const passwordValid = await verifyPassword(password, user.password);
    if (!passwordValid) {
      // Record failed login attempt and check if account should be locked
      const lockResult = recordFailedLogin(email.toLowerCase());
      if (lockResult.locked) {
        await auditLog({
          action: 'ACCOUNT_LOCKOUT',
          entity: 'User',
          entityId: user.id,
          details: JSON.stringify({ email: user.email, reason: 'too_many_failed_attempts' }),
          userId: user.id,
          officeId: user.officeId,
        });
        return NextResponse.json(
          {
            success: false,
            error: 'Conta bloqueada por excesso de tentativas. Tente novamente em 30 minutos.',
          },
          { status: 423 }
        );
      }
      return NextResponse.json(
        { success: false, error: 'Credenciais inválidas' },
        { status: 401 }
      );
    }

    // ============================================================================
    // SECURITY FIX: Clear lockout on successful login
    // ============================================================================
    clearAccountLockout(email.toLowerCase());

    // ============================================================================
    // SECURITY FIX: Added missing `await` on hashPassword during migration
    // Was storing [object Promise] as the password hash, making accounts unusable
    // Also using proper needsHashMigration() check instead of ad-hoc includes(':')
    // ============================================================================
    if (needsHashMigration(user.password)) {
      const newHashedPassword = await hashPassword(password);
      await db.user.update({
        where: { id: user.id },
        data: { password: newHashedPassword },
      });
    }

    if (!user.office || user.office.deleted || !user.office.active) {
      return NextResponse.json(
        { success: false, error: 'Escritório inativo ou removido' },
        { status: 403 }
      );
    }

    // SECURITY FIX: Removed email from token payload (PII exposure)
    const token = await signToken({
      userId: user.id,
      role: user.role,
      officeId: user.officeId,
    });

    // SECURITY FIX: Generate refresh token for session extension (#77)
    const refreshToken = await generateRefreshToken(user.id, user.role, user.officeId);

    // ============================================================================
    // SECURITY FIX: Include IP address and user agent in login audit
    // ============================================================================
    await auditLog({
      action: 'LOGIN',
      entity: 'User',
      entityId: user.id,
      details: JSON.stringify({ email: user.email }),
      userId: user.id,
      officeId: user.officeId,
      ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    });

    const response = NextResponse.json({
      success: true,
      data: {
        token, // DEPRECATED: Use HttpOnly cookie instead
        refreshToken, // DEPRECATED: Use HttpOnly cookie instead
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          officeId: user.officeId,
        },
        office: {
          id: user.office.id,
          name: user.office.name,
          cnpj: user.office.cnpj,
          email: user.office.email,
          phone: user.office.phone,
          address: user.office.address,
          city: user.office.city,
          state: user.office.state,
          zipCode: user.office.zipCode,
          logo: user.office.logo,
        },
      },
    });

    response.cookies.set('kiteos_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60, // 8 hours
    });

    response.cookies.set('kiteos_refresh', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth/refresh',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (error) {
    // SECURITY FIX (#69): Don't log error details that might contain sensitive data
    logger.error('Login error', { reason: 'REDACTED' });
    return NextResponse.json(
      { success: false, error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
