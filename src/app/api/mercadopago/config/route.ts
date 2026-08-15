import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { encryptToken, decryptToken } from '@/lib/token-encryption';

// GET /api/mercadopago/config - Get MP configuration for an office
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    // ============================================================================
    // SECURITY FIX: Added authentication check — was completely unauthenticated!
    // Any request could read MP configuration for any office.
    // ============================================================================
    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    const office = await db.office.findUnique({
      where: { id: officeId },
      select: {
        mpEnabled: true,
        mpSandbox: true,
        mpPublicKey: true,
        mpUserId: true,
        // SECURITY FIX: Don't even SELECT webhookSecret — was returning boolean
        // which reveals security configuration to potential attackers
      },
    });

    if (!office) {
      return NextResponse.json(
        { success: false, error: 'Oficina não encontrada' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        enabled: office.mpEnabled,
        sandbox: office.mpSandbox,
        publicKey: office.mpPublicKey,
        userId: office.mpUserId,
        // SECURITY FIX: Removed webhookSecretConfigured flag — info leak
        configured: !!office.mpPublicKey,
      },
    });
  } catch (error) {
    logger.error('Error getting MP config', { reason: 'REDACTED' });
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar configuração' },
      { status: 500 }
    );
  }
}

// PUT /api/mercadopago/config - Update MP configuration
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, mpAccessToken, mpPublicKey, mpSandbox, mpEnabled, mpWebhookSecret } = body;

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    // Only ADMIN should be able to configure payment gateway credentials
    const auth = await requireAuth(request, officeId, 'ADMIN');
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    // ============================================================================
    // SECURITY FIX: Validate mpAccessToken format (must start with APP_USR- or TEST-)
    // ============================================================================
    if (mpAccessToken && !mpAccessToken.startsWith('APP_USR-') && !mpAccessToken.startsWith('TEST-')) {
      return NextResponse.json(
        { success: false, error: 'Formato de access token inválido. Deve começar com APP_USR- ou TEST-.' },
        { status: 400 }
      );
    }

    // Save access token - try to validate, but store even if validation fails
    if (mpAccessToken) {
      let mpUserId: string | null = null;
      let validated = false;

      try {
        const testResponse = await fetch(
          'https://api.mercadopago.com/users/me',
          {
            headers: { Authorization: `Bearer ${mpAccessToken}` },
          }
        );

        if (testResponse.ok) {
          const userData = await testResponse.json();
          mpUserId = String(userData.id);
          validated = true;
        }
      } catch (e) {
        // SECURITY FIX (#69): Don't log full error which may contain token data
        logger.warn('MP validation error (saving anyway)', { reason: 'REDACTED' });
      }

      // SECURITY FIX (#79): Encrypt sensitive tokens before storing
      await db.office.update({
        where: { id: officeId },
        data: {
          mpAccessToken: encryptToken(mpAccessToken),
          mpPublicKey: mpPublicKey || undefined,
          mpWebhookSecret: encryptToken(mpWebhookSecret),
          mpSandbox: mpSandbox !== undefined ? mpSandbox : undefined,
          mpEnabled: mpEnabled !== undefined ? mpEnabled : true,
          mpUserId: mpUserId || undefined,
        },
      });

      // Audit log
      await db.auditLog.create({
        data: {
          action: 'UPDATE',
          entity: 'Office',
          entityId: officeId,
          details: JSON.stringify({ type: 'MP_CONFIG', enabled: true, validated, userId: mpUserId }),
          officeId,
        },
      });

      if (validated) {
        return NextResponse.json({
          success: true,
          data: {
            enabled: true,
            userId: mpUserId,
            validated: true,
            message: 'Mercado Pago configurado e validado com sucesso!',
          },
        });
      } else {
        return NextResponse.json({
          success: true,
          data: {
            enabled: mpEnabled !== false,
            validated: false,
            message: 'Token salvo, mas não foi possível validar online. Verifique se o token está correto.',
          },
        });
      }
    }

    // Just update enabled/sandbox flags
    await db.office.update({
      where: { id: officeId },
      data: {
        ...(mpSandbox !== undefined && { mpSandbox }),
        ...(mpEnabled !== undefined && { mpEnabled }),
      },
    });

    return NextResponse.json({
      success: true,
      data: { message: 'Configuração atualizada' },
    });
  } catch (error) {
    logger.error('Error updating MP config', { reason: 'REDACTED' });
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar configuração' },
      { status: 500 }
    );
  }
}

// DELETE /api/mercadopago/config - Remove MP integration
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    // Require ADMIN role for deletion
    const auth = await requireAuth(request, officeId, 'ADMIN');
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    await db.office.update({
      where: { id: officeId },
      data: {
        mpAccessToken: null,
        mpPublicKey: null,
        mpRefreshToken: null,
        mpUserId: null,
        mpWebhookSecret: null,
        mpEnabled: false,
        mpSandbox: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: { message: 'Integração com Mercado Pago removida' },
    });
  } catch (error) {
    logger.error('Error removing MP config', { reason: 'REDACTED' });
    return NextResponse.json(
      { success: false, error: 'Erro ao remover configuração' },
      { status: 500 }
    );
  }
}
