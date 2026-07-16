import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createHmac, timingSafeEqual } from 'crypto';
import { decryptToken } from '@/lib/token-encryption';

// ============================================================================
// SECURITY FIX: Added webhook signature validation (was completely missing!)
// Without signature validation, anyone can forge subscription payment notifications
// and activate premium plans without paying.
// ============================================================================
function validateWebhookSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!secret || !signature) return false;

  const parts = signature.split(',');
  let ts = '';
  let v1 = '';
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key.trim() === 'ts') ts = value.trim();
    if (key.trim() === 'v1') v1 = value.trim();
  }

  if (!ts || !v1) return false;

  // SECURITY: Validate timestamp freshness (reject if older than 5 minutes)
  const timestampMs = parseInt(ts, 10);
  if (isNaN(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    return false;
  }

  const manifest = `${ts}.${body}`;
  const expectedSignature = createHmac('sha256', secret)
    .update(manifest)
    .digest('hex');

  // SECURITY FIX: Use timingSafeEqual to prevent timing attacks
  if (expectedSignature.length !== v1.length) return false;
  try {
    return timingSafeEqual(
      Buffer.from(expectedSignature, 'utf8'),
      Buffer.from(v1, 'utf8')
    );
  } catch {
    return false;
  }
}

// POST /api/mercadopago/subscription-webhook - Receive MP notifications for subscription payments
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    const mpSignature = request.headers.get('x-signature');

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    // ============================================================================
    // SECURITY FIX: Reduced logging — don't log full webhook payload
    // Was logging entire body including potentially sensitive payment data
    // ============================================================================
    console.log('[MP Subscription Webhook] Received notification type:', body?.type, 'action:', body?.action);

    const { type, data, action } = body;

    // Handle payment notifications
    if (type === 'payment' || action === 'payment.created' || action === 'payment.updated') {
      const mpPaymentId = data?.id;

      if (!mpPaymentId) {
        return NextResponse.json({ success: false, error: 'No payment ID' }, { status: 400 });
      }

      // Determine which access token to use
      const mpAccessToken = process.env.MP_PLATFORM_ACCESS_TOKEN;

      // Try platform token first, then fall back to office tokens
      let paymentDetails: Record<string, unknown> | null = null;
      let matchedOfficeId: string | null = null;

      if (mpAccessToken && !mpAccessToken.includes('xxxxxxxx')) {
        // ============================================================================
        // SECURITY FIX: Validate webhook signature with platform-level secret
        // ============================================================================
        const platformSecret = process.env.MP_PLATFORM_WEBHOOK_SECRET;
        if (platformSecret) {
          if (!validateWebhookSignature(rawBody, mpSignature, platformSecret)) {
            console.error('[MP Subscription Webhook] REJECTED: Invalid signature for platform token');
            return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
          }
        }

        try {
          const mpResponse = await fetch(
            `https://api.mercadopago.com/v1/payments/${mpPaymentId}`,
            {
              headers: { Authorization: `Bearer ${mpAccessToken}` },
            }
          );
          if (mpResponse.ok) {
            paymentDetails = await mpResponse.json();
          }
        } catch (e) {
          console.error('[MP Subscription Webhook] Error fetching with platform token:', e);
        }
      }

      // If platform token didn't work, try office tokens WITH signature validation
      if (!paymentDetails) {
        const offices = await db.office.findMany({
          where: { active: true, deleted: false, mpAccessToken: { not: null } },
          select: { id: true, mpAccessToken: true, mpWebhookSecret: true },
        });

        for (const office of offices) {
          // SECURITY FIX (#79): Decrypt tokens before use
          const decryptedAccessToken = decryptToken(office.mpAccessToken);
          const decryptedWebhookSecret = decryptToken(office.mpWebhookSecret);
          
          if (!decryptedAccessToken) continue;

          // ============================================================================
          // SECURITY FIX: ALWAYS validate webhook signature when secret is configured
          // ============================================================================
          if (decryptedWebhookSecret) {
            if (!validateWebhookSignature(rawBody, mpSignature, decryptedWebhookSecret)) {
              continue; // Try next office
            }
          } else {
            // SECURITY FIX: Reject if no webhook secret configured
            console.warn('[MP Subscription Webhook] No webhook secret for office:', office.id, '- SKIPPING');
            continue;
          }

          try {
            const mpResponse = await fetch(
              `https://api.mercadopago.com/v1/payments/${mpPaymentId}`,
              {
                headers: { Authorization: `Bearer ${decryptedAccessToken}` },
              }
            );
            if (mpResponse.ok) {
              paymentDetails = await mpResponse.json();
              matchedOfficeId = office.id;
              break;
            }
          } catch {
            continue;
          }
        }
      }

      if (!paymentDetails) {
        console.warn('[MP Subscription Webhook] Could not fetch payment details');
        // SECURITY FIX: Return 500 so MP retries, not 200
        return NextResponse.json({ success: false, error: 'Could not fetch payment' }, { status: 500 });
      }

      // Check if this is a subscription payment
      const externalRef = paymentDetails.external_reference as string | undefined;

      if (!externalRef || !externalRef.startsWith('KITEOS-SUB-')) {
        return NextResponse.json({ success: true });
      }

      // Find subscription by preference ID
      const preferenceId = paymentDetails.preference_id as string | undefined;
      if (!preferenceId) {
        return NextResponse.json({ success: true });
      }

      // ============================================================================
      // SECURITY FIX: Scope subscription lookup by matchedOfficeId when available
      // Prevents cross-tenant subscription manipulation
      // ============================================================================
      const subscription = await db.subscription.findFirst({
        where: {
          mpPreferenceId: String(preferenceId),
          deleted: false,
          ...(matchedOfficeId ? { officeId: matchedOfficeId } : {}),
        },
      });

      if (!subscription) {
        console.warn('[MP Subscription Webhook] Subscription not found for preference:', preferenceId);
        return NextResponse.json({ success: true });
      }

      const mpStatus = paymentDetails.status as string;

      // ============================================================================
      // SECURITY FIX: Use transaction for all subscription state changes
      // Prevents race conditions and ensures atomicity
      // ============================================================================
      await db.$transaction(async (tx) => {
        // Update subscription with MP payment info
        await tx.subscription.update({
          where: { id: subscription.id },
          data: {
            mpPaymentId: String(mpPaymentId),
            mpStatus,
          },
        });

        // Handle payment approved
        if (mpStatus === 'approved') {
          const now = new Date();
          const periodEnd = new Date(now);
          periodEnd.setMonth(periodEnd.getMonth() + 1);

          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: 'ATIVA',
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
            },
          });

          // Create financial entry for the subscription payment (idempotency check)
          const existingFinancial = await tx.financialEntry.findFirst({
            where: {
              officeId: subscription.officeId,
              reference: `SUB-MP-${subscription.id}`,
              deleted: false,
            },
          });

          if (!existingFinancial) {
            await tx.financialEntry.create({
              data: {
                officeId: subscription.officeId,
                type: 'PAGAR',
                category: 'ASSINATURA',
                description: `Assinatura Plano ${subscription.plan} - KiteOS (Mercado Pago)`,
                amount: subscription.monthlyPrice,
                discount: 0,
                interest: 0,
                totalAmount: subscription.monthlyPrice,
                status: 'PAGO',
                dueDate: now,
                paymentDate: now,
                paymentMethod: 'MERCADO_PAGO',
                reference: `SUB-MP-${subscription.id}`,
              },
            });
          }

          // Create notification
          await tx.notification.create({
            data: {
              type: 'SYSTEM',
              title: 'Pagamento Aprovado',
              message: `Pagamento do plano ${subscription.plan} foi aprovado via Mercado Pago.`,
              status: 'PENDENTE',
              officeId: subscription.officeId,
            },
          });

          // Audit log
          await tx.auditLog.create({
            data: {
              action: 'SUBSCRIPTION_PAYMENT_APPROVED',
              entity: 'Subscription',
              entityId: subscription.id,
              details: JSON.stringify({
                mpPaymentId: String(mpPaymentId),
                plan: subscription.plan,
                amount: subscription.monthlyPrice,
              }),
              officeId: subscription.officeId,
            },
          });
        }

        // Handle payment rejected or cancelled
        if (mpStatus === 'rejected' || mpStatus === 'cancelled') {
          await tx.subscription.update({
            where: { id: subscription.id },
            data: {
              status: 'CANCELADA',
              plan: 'FREE',
              monthlyPrice: 0,
              mpStatus: mpStatus,
            },
          });

          await tx.notification.create({
            data: {
              type: 'SYSTEM',
              title: 'Pagamento Rejeitado',
              message: `Pagamento do plano foi rejeitado. Tente novamente.`,
              status: 'PENDENTE',
              officeId: subscription.officeId,
            },
          });
        }
      });

      console.log(`[MP Subscription Webhook] Payment ${mpPaymentId} processed for subscription ${subscription.id}`);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[MP Subscription Webhook] Error:', error);
    // ============================================================================
    // SECURITY FIX: Return 500 on genuine server errors so MP retries
    // Was always returning 200, hiding processing failures
    // ============================================================================
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}

// GET - MP validates webhook with GET
export async function GET(request: NextRequest) {
  return NextResponse.json({ status: 'ok' });
}
