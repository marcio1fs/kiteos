import { NextRequest, NextResponse } from 'next/server';
import { revokeRefreshToken, addToTokenBlacklist, auditLog, getAuthFromRequest } from '@/lib/auth';

/**
 * POST /api/auth/logout
 * Revoke refresh token and blacklist the current JWT
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { refreshToken } = body;

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

    return NextResponse.json({
      success: true,
      data: { message: 'Logout realizado com sucesso' },
    });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao realizar logout' },
      { status: 500 }
    );
  }
}
