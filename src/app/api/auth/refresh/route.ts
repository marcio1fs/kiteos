import { NextRequest, NextResponse } from 'next/server';
import { rotateRefreshToken, auditLog } from '@/lib/auth';

/**
 * POST /api/auth/refresh
 * Exchange a valid refresh token for a new JWT + new refresh token
 * Implements rotation: old refresh token is invalidated after use
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { refreshToken } = body;

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

    return NextResponse.json({
      success: true,
      data: {
        token: result.token,
        refreshToken: result.refreshToken,
        user: {
          id: result.payload.userId,
          role: result.payload.role,
          officeId: result.payload.officeId,
        },
      },
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao renovar token' },
      { status: 500 }
    );
  }
}
