import { NextRequest, NextResponse } from 'next/server';
import { revokeRefreshToken, addToTokenBlacklist, auditLog, getAuthFromRequest } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * POST /api/auth/logout
 * Revoke refresh token and blacklist the current JWT
 */
export async function POST(request: NextRequest) {
  try {
    let body: { refreshToken?: string } = {};
    try {
      body = await request.json();
    } catch (e) {}
    const refreshToken = request.cookies.get('kiteos_refresh')?.value || body.refreshToken;

    // Get current user from JWT
    const payload = await getAuthFromRequest(request);

    // Revoke the refresh token
    if (refreshToken) {
      await revokeRefreshToken(refreshToken);
    }

    // Blacklist the current JWT
    if (payload) {
      await addToTokenBlacklist(payload.userId, payload.officeId, 'LOGOUT');

      await auditLog({
        action: 'LOGOUT',
        entity: 'User',
        entityId: payload.userId,
        officeId: payload.officeId,
        userId: payload.userId,
        ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
        userAgent: request.headers.get('user-agent') || 'unknown',
      });
    }

    const response = NextResponse.json({
      success: true,
      data: { message: 'Logout realizado com sucesso' },
    });

    response.cookies.set('kiteos_token', '', { maxAge: 0, path: '/' });
    response.cookies.set('kiteos_refresh', '', { maxAge: 0, path: '/api/auth/refresh' });

    return response;
  } catch (error) {
    logger.error('Logout error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao realizar logout' },
      { status: 500 }
    );
  }
}
