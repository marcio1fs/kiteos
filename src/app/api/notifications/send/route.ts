import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { requireAuth } from '@/lib/auth';
import { decryptToken } from '@/lib/token-encryption';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      officeId,
      userId,
      type,
      title,
      message,
      recipient,
      template,
      serviceOrderId,
    } = body;

    const errors: string[] = [];

    if (!officeId) errors.push('officeId é obrigatório');
    if (!type) errors.push('type é obrigatório (WHATSAPP, EMAIL, SYSTEM)');
    if (!title) errors.push('title é obrigatório');
    if (!message) errors.push('message é obrigatório');

    if (errors.length > 0) {
      return NextResponse.json({ success: false, errors }, { status: 400 });
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }

    // For WhatsApp, recipient (phone) is required
    if (type === 'WHATSAPP' && !recipient) {
      errors.push('recipient (telefone) é obrigatório para notificações WhatsApp');
    }

    // For EMAIL, recipient (email) is required
    if (type === 'EMAIL' && !recipient) {
      errors.push('recipient (email) é obrigatório para notificações por email');
    }

    if (!['WHATSAPP', 'EMAIL', 'SYSTEM'].includes(type)) {
      errors.push('type deve ser WHATSAPP, EMAIL ou SYSTEM');
    }

    if (errors.length > 0) {
      return NextResponse.json({ success: false, errors }, { status: 400 });
    }

    // Create notification record
    const notification = await db.notification.create({
      data: {
        type,
        template: template || null,
        title,
        message,
        recipient: recipient || null,
        status: 'PENDENTE',
        serviceOrderId: serviceOrderId || null,
        officeId,
      },
    });

    // Simulate sending based on type
    /**
     * NOT-01: `notIntegrated` separa "tentamos entregar e falhou" de "não existe
     * integração para tentar". Só o primeiro pode virar FALHOU; o segundo continua
     * PENDENTE, porque gravar ENVIADA aqui é afirmar uma entrega que não houve.
     */
    let sendResult: { success: boolean; method: string; details: string; notIntegrated?: boolean };

    try {
      switch (type) {
        case 'WHATSAPP': {
          // Try to send via configured WhatsApp API (Z-API / Evolution API)
          const officeData = await db.office.findUnique({
            where: { id: officeId },
            select: { waEnabled: true, waApiUrl: true, waApiToken: true, waInstance: true },
          });

          const waApiToken = decryptToken(officeData?.waApiToken);

          if (officeData?.waEnabled && officeData.waApiUrl && waApiToken && officeData.waInstance && recipient) {
            // Format phone number
            let phone = recipient.replace(/\D/g, '');
            if (phone.startsWith('0')) phone = phone.substring(1);
            if (!phone.startsWith('55') && phone.length >= 10) phone = '55' + phone;

            let waSuccess = false;
            let waMethod = '';
            let waDetails = '';

            // Try Z-API format
            try {
              const zUrl = `${officeData.waApiUrl.replace(/\/$/, '')}/instances/${officeData.waInstance}/token/${waApiToken}/send-text`;
              const zRes = await fetch(zUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify({ phone, message }),
                signal: AbortSignal.timeout(15000),
              });
              if (zRes.ok) {
                waSuccess = true;
                waMethod = 'WHATSAPP_ZAPI';
                waDetails = `Mensagem enviada via Z-API para ${phone}`;
              }
            } catch { /* Z-API failed, try Evolution */ }

            // Try Evolution API format if Z-API failed
            if (!waSuccess) {
              try {
                const eUrl = `${officeData.waApiUrl.replace(/\/$/, '')}/message/sendText/${officeData.waInstance}`;
                const eRes = await fetch(eUrl, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'apikey': waApiToken },
                  body: JSON.stringify({ number: phone, text: message }),
                  signal: AbortSignal.timeout(15000),
                });
                if (eRes.ok) {
                  waSuccess = true;
                  waMethod = 'WHATSAPP_EVOLUTION';
                  waDetails = `Mensagem enviada via Evolution API para ${phone}`;
                }
              } catch { /* Evolution API also failed */ }
            }

            if (waSuccess) {
              sendResult = { success: true, method: waMethod, details: waDetails };
            } else {
              sendResult = {
                success: false,
                method: 'WHATSAPP_FAILED',
                details: `Falha ao enviar via WhatsApp para ${phone}. Verifique a configuração da API.`,
              };
            }
          } else {
            sendResult = {
              success: false,
              notIntegrated: true,
              method: 'WHATSAPP_NAO_INTEGRADO',
              details: `WhatsApp não configurado para esta oficina — nada foi enviado a ${recipient}. Configure a API no perfil da oficina.`,
            };
          }
          break;
        }

        case 'EMAIL':
          // NOT-01/sonda 15: não existe provedor de e-mail integrado (SendGrid/SES/
          // SMTP). Nada foi enviado, então o registro não pode sair como ENVIADA:
          // fica PENDENTE e a resposta diz explicitamente que não houve entrega.
          sendResult = {
            success: false,
            notIntegrated: true,
            method: 'EMAIL_NAO_INTEGRADO',
            details: `E-mail não integrado — nada foi enviado para ${recipient}. Integre um provedor (SendGrid/SES/SMTP) para habilitar a entrega.`,
          };
          break;

        case 'SYSTEM':
          // System notification - just mark as sent
          sendResult = {
            success: true,
            method: 'SYSTEM',
            details: 'Notificação de sistema criada e exibida ao usuário.',
          };
          break;

        default:
          sendResult = {
            success: false,
            method: 'UNKNOWN',
            details: 'Tipo de notificação não suportado',
          };
      }

      // ENVIADA só com entrega aceita pelo provedor. Sem integração, o registro
      // continua PENDENTE (nada foi tentado); falha real de entrega vira FALHOU.
      if (sendResult.success) {
        await db.notification.update({
          where: { id: notification.id },
          data: {
            status: 'ENVIADA',
            sentAt: new Date(),
          },
        });
      } else if (sendResult.notIntegrated) {
        await db.notification.update({
          where: { id: notification.id },
          data: {
            status: 'PENDENTE',
          },
        });
      } else {
        await db.notification.update({
          where: { id: notification.id },
          data: {
            status: 'FALHOU',
          },
        });
      }
    } catch (sendError) {
      // If sending fails, mark as failed
      await db.notification.update({
        where: { id: notification.id },
        data: {
          status: 'FALHOU',
        },
      });

      sendResult = {
        success: false,
        method: type,
        details: `Erro ao enviar: ${sendError instanceof Error ? sendError.message : 'Erro desconhecido'}`,
      };
    }

    // Create audit log
    await createAuditLog({
      action: 'SEND_NOTIFICATION',
      entity: 'Notification',
      entityId: notification.id,
      details: JSON.stringify({
        type,
        recipient,
        title,
        sendResult,
      }),
      userId: auth.payload.userId, // SEC-14/NOT-01 FIX: Use auth.payload.userId instead of body userId
      officeId,
    });

    const updatedNotification = await db.notification.findFirst({
      where: { id: notification.id },
    });

    return NextResponse.json({
      // A notificação foi criada, mas "criada" não é "entregue": sem provedor,
      // success sai false para o chamador não acreditar numa entrega inexistente.
      success: sendResult.success,
      delivered: sendResult.success,
      notIntegrated: sendResult.notIntegrated === true,
      data: {
        notification: updatedNotification,
        sendResult,
      },
    }, { status: 201 });

  } catch (error) {
    logger.error('Error sending notification:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao enviar notificação'] },
      { status: 500 }
    );
  }
}
