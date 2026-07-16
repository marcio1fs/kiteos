import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { decryptToken, encryptToken } from '@/lib/token-encryption';

// GET /api/whatsapp/config - Get WhatsApp configuration for an office
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
        waEnabled: true,
        waApiUrl: true,
        waApiToken: true,
        waInstance: true,
        waPhone: true,
        waWebhookSecret: true,
        // API token is needed to check existence but won't be exposed in response
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
        enabled: office.waEnabled,
        apiUrl: office.waApiUrl,
        instance: office.waInstance,
        phone: office.waPhone,
        webhookSecretConfigured: !!office.waWebhookSecret,
        hasToken: !!office.waApiToken, // Indicate if token exists without exposing it
        configured: !!(office.waApiUrl && office.waInstance),
      },
    });
  } catch (error) {
    console.error('Error getting WhatsApp config:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar configuração do WhatsApp' },
      { status: 500 }
    );
  }
}

// PUT /api/whatsapp/config - Update WhatsApp configuration
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, waEnabled, waApiUrl, waApiToken, waInstance, waPhone, waWebhookSecret, testOnly } = body;

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    // Sanitize API URL - users often paste the full endpoint URL
    let cleanApiUrl = waApiUrl;
    let cleanInstance = waInstance;
    let cleanToken = waApiToken;

    if (cleanApiUrl && typeof cleanApiUrl === 'string') {
      cleanApiUrl = cleanApiUrl.trim().replace(/\/+$/, '');

      // Detect Z-API full URL pattern: extract instance and token from it
      const zApiMatch = cleanApiUrl.match(/^(https?:\/\/[^\/]+)\/instances\/([^\/]+)\/token\/([^\/]+)/i);
      if (zApiMatch) {
        cleanApiUrl = zApiMatch[1];
        if (!cleanInstance) cleanInstance = zApiMatch[2];
        if (!cleanToken) cleanToken = zApiMatch[3];
      } else {
        // Just clean up the URL - remove endpoint paths
        const evoMatch = cleanApiUrl.match(/^(https?:\/\/[^\/]+)\/(message|instance|chat)\//i);
        if (evoMatch) {
          cleanApiUrl = evoMatch[1];
        } else {
          // Try parsing as URL and keep only origin + optional /v1 /api base
          try {
            const parsed = new URL(cleanApiUrl);
            if (parsed.pathname.length > 1) {
              const apiBaseMatch = parsed.pathname.match(/^(\/(v\d+|api)(\/|$))/);
              if (apiBaseMatch) {
                cleanApiUrl = `${parsed.origin}${apiBaseMatch[1].replace(/\/$/, '')}`;
              } else {
                cleanApiUrl = parsed.origin;
              }
            } else {
              cleanApiUrl = parsed.origin;
            }
          } catch {
            // Keep as-is if can't parse
          }
        }
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (waEnabled !== undefined) updateData.waEnabled = waEnabled;
    if (cleanApiUrl !== undefined) updateData.waApiUrl = cleanApiUrl || null;
    if (cleanToken !== undefined) updateData.waApiToken = cleanToken ? encryptToken(cleanToken) : null;
    if (cleanInstance !== undefined) updateData.waInstance = cleanInstance || null;
    if (waPhone !== undefined) updateData.waPhone = waPhone || null;
    if (waWebhookSecret !== undefined) updateData.waWebhookSecret = waWebhookSecret ? encryptToken(waWebhookSecret) : null;

    // If enabling, validate that required fields are present
    if (waEnabled) {
      const existing = await db.office.findUnique({
        where: { id: officeId },
        select: { waApiToken: true, waApiUrl: true, waInstance: true },
      });
      if (!existing?.waApiToken && !cleanToken) {
        return NextResponse.json(
          { success: false, error: 'Para ativar o WhatsApp, configure a URL da API, Instância e Token primeiro.' },
          { status: 400 }
        );
      }
    }

    // If testOnly, just test the connection without saving
    if (testOnly) {
      const storedToken = (await db.office.findUnique({ where: { id: officeId }, select: { waApiToken: true } }))?.waApiToken;
      const tokenToUse = cleanToken || decryptToken(storedToken);
      const urlToUse = cleanApiUrl || (await db.office.findUnique({ where: { id: officeId }, select: { waApiUrl: true } }))?.waApiUrl;
      const instanceToUse = cleanInstance || (await db.office.findUnique({ where: { id: officeId }, select: { waInstance: true } }))?.waInstance;

      if (!tokenToUse || !urlToUse || !instanceToUse) {
        return NextResponse.json({
          success: false,
          error: 'Configure URL da API, Instância e Token antes de testar.',
        }, { status: 400 });
      }

      let validated = false;
      let validationDetails = '';

      try {
        // Test Z-API format
        const testUrl = `${urlToUse.replace(/\/$/, '')}/instances/${instanceToUse}/token/${tokenToUse}/status`;
        const testResponse = await fetch(testUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });

        if (testResponse.ok) {
          validated = true;
          validationDetails = 'Z-API conectado com sucesso!';
        } else {
          // Try Evolution API format
          try {
            const evoUrl = `${urlToUse.replace(/\/$/, '')}/instance/fetchInstances`;
            const evoResponse = await fetch(evoUrl, {
              method: 'GET',
              headers: { 'Accept': 'application/json', 'apikey': tokenToUse },
              signal: AbortSignal.timeout(10000),
            });
            if (evoResponse.ok) {
              validated = true;
              validationDetails = 'Evolution API conectado com sucesso!';
            } else {
              validationDetails = `Z-API: ${testResponse.status} | Evolution: ${evoResponse.status}`;
            }
          } catch {
            validationDetails = `Z-API: ${testResponse.status} | Evolution: sem resposta`;
          }
        }
      } catch (e) {
        validationDetails = 'Não foi possível conectar. Verifique URL, Instância e Token.';
      }

      return NextResponse.json({
        success: validated,
        data: {
          validated,
          message: validated ? validationDetails : `Conexão falhou: ${validationDetails}`,
        },
      });
    }

    // Try to validate the connection if token/apiUrl provided
    let validated = false;
    let validationMessage = '';

    if (cleanToken && cleanApiUrl && cleanInstance) {
      try {
        // Test connection - try Z-API format first
        const testUrl = `${cleanApiUrl.replace(/\/$/, '')}/instances/${cleanInstance}/token/${cleanToken}/status`;
        const testResponse = await fetch(testUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(8000),
        });

        if (testResponse.ok) {
          validated = true;
        } else {
          // Try Evolution API format
          try {
            const evoUrl = `${cleanApiUrl.replace(/\/$/, '')}/instance/fetchInstances`;
            const evoResponse = await fetch(evoUrl, {
              method: 'GET',
              headers: {
                'Accept': 'application/json',
                'apikey': cleanToken,
              },
              signal: AbortSignal.timeout(8000),
            });
            if (evoResponse.ok) {
              validated = true;
            }
          } catch {
            // Evolution API test failed too
          }
        }
      } catch (e) {
        console.warn('WhatsApp API validation error (saving anyway):', e);
        validationMessage = 'Não foi possível validar a conexão. Verifique URL e Token.';
      }
    }

    await db.office.update({
      where: { id: officeId },
      data: updateData,
    });

    // Audit log
    await db.auditLog.create({
      data: {
        action: 'UPDATE',
        entity: 'Office',
        entityId: officeId,
        details: JSON.stringify({ type: 'WHATSAPP_CONFIG', enabled: waEnabled, validated }),
        officeId,
      },
    });

    if (validated) {
      return NextResponse.json({
        success: true,
        data: {
          enabled: true,
          validated: true,
          message: 'WhatsApp configurado e conectado com sucesso!',
        },
      });
    } else if (validationMessage) {
      return NextResponse.json({
        success: true,
        data: {
          enabled: waEnabled !== false,
          validated: false,
          message: validationMessage,
        },
      });
    } else {
      return NextResponse.json({
        success: true,
        data: {
          message: 'Configuração do WhatsApp salva com sucesso!',
        },
      });
    }
  } catch (error) {
    console.error('Error updating WhatsApp config:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar configuração do WhatsApp' },
      { status: 500 }
    );
  }
}

// DELETE /api/whatsapp/config - Remove WhatsApp integration
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

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    await db.office.update({
      where: { id: officeId },
      data: {
        waEnabled: false,
        waApiUrl: null,
        waApiToken: null,
        waInstance: null,
        waPhone: null,
        waWebhookSecret: null,
      },
    });

    return NextResponse.json({
      success: true,
      data: { message: 'Integração com WhatsApp removida' },
    });
  } catch (error) {
    console.error('Error removing WhatsApp config:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao remover configuração do WhatsApp' },
      { status: 500 }
    );
  }
}
