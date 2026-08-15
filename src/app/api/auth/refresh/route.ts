import { NextRequest, NextResponse } from 'next/server';
import { rotateRefreshToken, auditLog } from '@/lib/auth';
import { logger } from '@/lib/logger';

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a new JWT + new refresh token
 * Implements rotation: old refresh token is invalidated after use
 */
export async function POST(request: NextRequest) {
  try {
    let body: { refreshToken?: string } = {};
    try {
      body = await request.json();
    } catch (e) {}
    const refreshToken = request.cookies.get('kiteos_refresh')?.value || body.refreshToken;

    if (!refreshToken || typeof refreshToken !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Refresh token é obrigatório' },
        { status: 400 }
      );
    }

    const result = await rotateRefreshToken(refreshToken);

    if (!result) {
      // Token reuse detected or invalid token
      return NextResponse.json(
        { success: false, error: 'Refresh token inválido ou revogado. Faça login novamente.' },
        { status: 401 }
      );
    }

    const response = NextResponse.json({
      success: true,
      data: {
        token: result.token, // DEPRECATED: Use HttpOnly cookie instead
        refreshToken: result.refreshToken, // DEPRECATED: Use HttpOnly cookie instead
        user: {
          id: result.payload.userId,
          role: result.payload.role,
          officeId: result.payload.officeId,
        },
      },
    });

    response.cookies.set('kiteos_token', result.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60, // 8 hours
    });

    response.cookies.set('kiteos_refresh', result.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/auth/refresh',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    return response;
  } catch (error) {
    logger.error('Token refresh error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao renovar token' },
      { status: 500 }
    );
  }
}
