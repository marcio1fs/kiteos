import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createHmac, timingSafeEqual } from 'crypto';
import { decryptToken } from '@/lib/token-encryption';

// ============================================================================
// SECURITY FIX: Webhook signature validation now REJECTS if signature or secret is missing
// Previously returned true (bypass) when either was absent
// ============================================================================
function validateWebhookSignature(
  body: string,
  signature: string | null,
  secret: string
): boolean {
  if (!secret) {
    console.error('[MP Webhook] REJECTED: No webhook secret configured for this office');
    return false; // SECURITY FIX: Reject if no secret configured
  }
  if (!signature) {
    console.error('[MP Webhook] REJECTED: No signature provided in request');
    return false; // SECURITY FIX: Reject if no signature provided
  }

  const parts = signature.split(',');
  let ts = '';
  let v1 = '';
  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key.trim() === 'ts') ts = value.trim();
    if (key.trim() === 'v1') v1 = value.trim();
  }

  if (!ts || !v1) return false;

  // SECURITY FIX: Validate timestamp freshness (reject if older than 5 minutes)
  const timestampMs = parseInt(ts, 10);
  if (isNaN(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    console.error('[MP Webhook] REJECTED: Timestamp too old or invalid (possible replay attack)');
    return false;
  }

  const manifest = `${ts}.${body}`;
  const expectedSignature = createHmac('sha256', secret)
    .update(manifest)
    .digest('hex');

  // SECURITY FIX: Use timingSafeEqual instead of === to prevent timing attacks
  // Regular string comparison leaks information through response time differences
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

// POST /api/mercadopago/webhook - Receive Mercado Pago notifications
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

    // SECURITY FIX: Reduced logging — don't log full webhook payload
    console.log('[MP Webhook] Received notification type:', body?.type, 'action:', body?.action);

    const { type, data, action } = body;

    if (type === 'payment' || action === 'payment.created' || action === 'payment.updated') {
      const mpPaymentId = data?.id;

      if (!mpPaymentId) {
        return NextResponse.json({ success: false, error: 'No payment ID' }, { status: 400 });
      }

      // Find the sale by external reference using MP API to get the payment details first
      // We need to find which office this payment belongs to
      const offices = await db.office.findMany({
        where: { active: true, deleted: false },
        select: {
          id: true,
          name: true,
          mpAccessToken: true,
          mpWebhookSecret: true,
        },
      });

      for (const office of offices) {
        // SECURITY FIX (#79): Decrypt tokens before use
        const decryptedAccessToken = decryptToken(office.mpAccessToken);
        const decryptedWebhookSecret = decryptToken(office.mpWebhookSecret);
        
        if (!decryptedAccessToken) continue;

        // SECURITY FIX: ALWAYS validate webhook signature when secret is configured
        if (decryptedWebhookSecret) {
          const isValid = validateWebhookSignature(rawBody, mpSignature, decryptedWebhookSecret);
          if (!isValid) {
            console.warn('[MP Webhook] Invalid signature for office:', office.id);
            continue;
          }
        } else {
          // SECURITY FIX: Reject if no webhook secret is configured
          console.warn('[MP Webhook] No webhook secret configured for office:', office.id, '- SKIPPING');
          continue;
        }

        try {
          const mpResponse = await fetch(
            `https://api.mercadopago.com/v1/payments/${mpPaymentId}`,
            {
              headers: { Authorization: `Bearer ${decryptedAccessToken}` },
            }
          );

          if (!mpResponse.ok) continue;

          const mpPayment = await mpResponse.json();
          const externalRef = mpPayment.external_reference;

          if (!externalRef) continue;

          // Find the sale by number
          const sale = await db.sale.findFirst({
            where: { number: externalRef, officeId: office.id, deleted: false },
            include: { items: { where: { deleted: false } } },
          });

          if (!sale) continue;

          // Map MP status to our status
          const statusMap: Record<string, string> = {
            pending: 'PENDENTE',
            approved: 'APROVADO',
            authorized: 'PENDENTE',
            in_process: 'PENDENTE',
            in_mediation: 'PENDENTE',
            rejected: 'REJEITADO',
            cancelled: 'CANCELADO',
            refunded: 'ESTORNADO',
            charged_back: 'ESTORNADO',
          };

          const newStatus = statusMap[mpPayment.status] || 'PENDENTE';
          const paidAt = mpPayment.date_approved ? new Date(mpPayment.date_approved) : null;

          // If payment is approved, finalize the sale
          // SECURITY FIX: Use transaction for idempotency and atomicity
          if (newStatus === 'APROVADO' && sale.status !== 'PAGA') {
            // SECURITY FIX: Check for idempotency — prevent duplicate processing
            const existingEntry = await db.financialEntry.findFirst({
              where: {
                saleId: sale.id,
                status: 'PAGO',
                paymentMethod: 'MERCADO_PAGO',
                deleted: false,
              },
            });
            if (existingEntry) {
              console.log('[MP Webhook] Payment already processed for sale:', sale.number, '- skipping');
              break;
            }

            await db.$transaction(async (tx) => {
              // Double-check status inside transaction
              const currentSale = await tx.sale.findFirst({
                where: { id: sale.id, deleted: false },
              });
              if (!currentSale || currentSale.status === 'PAGA') return;

              await tx.sale.update({
                where: { id: sale.id },
                data: {
                  status: 'PAGA',
                  paymentMethod: 'MERCADO_PAGO',
                  paidAt: paidAt || new Date(),
                },
              });

              // Deduct stock
              for (const item of sale.items) {
                if (item.partId) {
                  const part = await tx.part.findFirst({
                    where: { id: item.partId, officeId: office.id, deleted: false },
                  });
                  if (part) {
                    const currentQty = parseFloat(String(part.quantity));
                    const newQty = Math.max(0, currentQty - Number(item.quantity));
                    await tx.part.update({
                      where: { id: item.partId },
                      data: { quantity: newQty },
                    });
                    await tx.stockMovement.create({
                      data: {
                        type: 'SAIDA',
                        quantity: Number(item.quantity),
                        unitCost: Number(part.costPrice),
                        reason: 'Venda PDV (Mercado Pago)',
                        reference: sale.number,
                        partId: item.partId,
                        officeId: office.id,
                      },
                    });
                  }
                }
              }

              // Create financial entry
              await tx.financialEntry.create({
                data: {
                  type: 'RECEBER',
                  category: 'PDV',
                  description: `Venda PDV ${sale.number} (Mercado Pago)`,
                  amount: Number(sale.totalAmount),
                  discount: Number(sale.discount),
                  interest: 0,
                  totalAmount: Number(sale.totalAmount) - Number(sale.discount),
                  status: 'PAGO',
                  dueDate: new Date(),
                  paymentDate: paidAt || new Date(),
                  paymentMethod: 'MERCADO_PAGO',
                  reference: `MP-${mpPaymentId}`,
                  saleId: sale.id,
                  officeId: office.id,
                },
              });

              // Create notification
              await tx.notification.create({
                data: {
                  type: 'SYSTEM',
                  title: 'Pagamento Aprovado',
                  message: `Pagamento da venda ${sale.number} foi aprovado via Mercado Pago.`,
                  status: 'PENDENTE',
                  officeId: office.id,
                },
              });

              // Audit log
              await tx.auditLog.create({
                data: {
                  action: 'PAYMENT_APPROVED',
                  entity: 'Sale',
                  entityId: sale.id,
                  details: JSON.stringify({
                    mpPaymentId: String(mpPaymentId),
                    amount: Number(sale.totalAmount),
                    method: mpPayment.payment_type_id,
                  }),
                  officeId: office.id,
                },
              });
            });
          }

          // If payment was rejected or cancelled
          if ((newStatus === 'REJEITADO' || newStatus === 'CANCELADO') && sale.status === 'ABERTA') {
            await db.sale.update({
              where: { id: sale.id },
              data: { status: 'CANCELADA' },
            });
          }

          // Found the right office, no need to continue
          break;
        } catch (fetchError) {
          console.error('[MP Webhook] Error fetching payment details:', fetchError);
          continue;
        }
      }
    }

    // Always return 200 to MP
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[MP Webhook] Error:', error);
    // SECURITY FIX: Return 500 on genuine server errors so MP retries
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}

// GET /api/mercadopago/webhook - MP validates webhook with GET
export async function GET(request: NextRequest) {
  return NextResponse.json({ status: 'ok' });
}
