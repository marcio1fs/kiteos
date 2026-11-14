import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { decryptToken } from '@/lib/token-encryption';
import { validateMpSignature, fetchMpPayment, type MpPayment } from '@/lib/mercadopago-webhook';
import { paySale, cancelSale, reverseSale } from '@/lib/sales';
import { systemActor } from '@/lib/reversals';
import { CommercialError, toCents } from '@/lib/commercial';
import { z } from 'zod';

/**
 * Identity recorded for machine-initiated writes. `audit_logs.userId` is a FK to
 * `users.id`, so a webhook cannot be stored there: the label goes into
 * `details.actor` and the FK stays null (see `auditTrail`).
 */
const MP_WEBHOOK_ACTOR = 'mercadopago-webhook';

const notificationSchema = z.object({
  type: z.string().optional(),
  action: z.string().optional(),
  data: z.object({ id: z.union([z.string(), z.number()]) }).optional(),
}).passthrough();

function parseSaleReference(ref: string | null | undefined): { officeId: string; saleId: string } | null {
  const m = /^SALE:([^:]+):([^:]+)$/.exec(ref || '');
  return m ? { officeId: m[1], saleId: m[2] } : null;
}

async function resolveSale(payment: MpPayment, officeId: string) {
  const ref = parseSaleReference(payment.external_reference);
  if (ref) {
    if (ref.officeId !== officeId) return null;
    return db.sale.findFirst({ where: { id: ref.saleId, officeId, deleted: false }, include: { items: { where: { deleted: false } } } });
  }
  // Legacy preferences used the sale number as external_reference.
  if (!payment.external_reference) return null;
  return db.sale.findFirst({ where: { number: payment.external_reference, officeId, deleted: false }, include: { items: { where: { deleted: false } } } });
}

// POST /api/mercadopago/webhook - Sale payment notifications
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    let body: z.infer<typeof notificationSchema>;
    try {
      body = notificationSchema.parse(JSON.parse(rawBody));
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 });
    }

    const isPayment = body.type === 'payment' || body.action?.startsWith('payment.');
    if (!isPayment) return NextResponse.json({ success: true, ignored: true });
    if (!body.data?.id) return NextResponse.json({ success: false, error: 'No payment ID' }, { status: 400 });
    const paymentId = String(body.data.id);
    const dataId = new URL(request.url).searchParams.get('data.id') || paymentId;

    const offices = await db.office.findMany({
      where: { active: true, deleted: false, mpEnabled: true, mpAccessToken: { not: null }, mpWebhookSecret: { not: null } },
      select: { id: true, mpAccessToken: true, mpWebhookSecret: true, mpUserId: true },
    });

    let authenticated = false;
    for (const office of offices) {
      const secret = decryptToken(office.mpWebhookSecret);
      const token = decryptToken(office.mpAccessToken);
      if (!secret || !token) continue;
      if (!validateMpSignature({
        xSignature: request.headers.get('x-signature'),
        xRequestId: request.headers.get('x-request-id'),
        dataId,
        secret,
      })) continue;
      authenticated = true;

      let payment: MpPayment | null;
      try {
        payment = await fetchMpPayment(paymentId, token);
      } catch (error) {
        logger.error('[MP Webhook] Failed to fetch payment', { officeId: office.id, error: error instanceof Error ? error.message : String(error) });
        return NextResponse.json({ success: false, error: 'Payment lookup failed' }, { status: 502 });
      }
      if (!payment) continue;
      if (office.mpUserId && payment.collector_id !== undefined && String(payment.collector_id) !== String(office.mpUserId)) {
        logger.warn('[MP Webhook] Collector mismatch', { officeId: office.id });
        continue;
      }

      const sale = await resolveSale(payment, office.id);
      if (!sale) continue;

      if (payment.status === 'approved') {
        const paidCents = Math.round(Number(payment.transaction_amount ?? NaN) * 100);
        const expectedCents = toCents(Number(sale.totalAmount));
        if (payment.currency_id !== 'BRL' || !Number.isFinite(paidCents) || paidCents !== expectedCents) {
          await db.auditLog.create({
            data: {
              action: 'PAYMENT_AMOUNT_MISMATCH', entity: 'Sale', entityId: sale.id,
              details: JSON.stringify({ mpPaymentId: paymentId, expectedCents, paidCents, currency: payment.currency_id }),
              officeId: office.id,
            },
          });
          return NextResponse.json({ success: false, error: 'Payment amount/currency mismatch' }, { status: 409 });
        }
        try {
          await paySale(sale.id, office.id, 'MERCADO_PAGO', null, undefined, MP_WEBHOOK_ACTOR);
        } catch (error) {
          if (error instanceof CommercialError && error.status === 409) {
            // Already paid or concurrently changed; safe to acknowledge.
            logger.info('[MP Webhook] Sale already settled or changed', { saleId: sale.id });
          } else throw error;
        }
        return NextResponse.json({ success: true });
      }

      if ((payment.status === 'rejected' || payment.status === 'cancelled') && sale.status === 'ABERTA') {
        try {
          await cancelSale(sale.id, office.id, null, MP_WEBHOOK_ACTOR);
        } catch (error) {
          if (!(error instanceof CommercialError)) throw error;
        }
      }
      // Refunds and chargebacks undo a settled sale through the explicit reversal
      // flow: money back on the ledger, stock back on the shelf, sale ESTORNADA
      // (PAY-06). reverseSale is idempotent and its status transition is the
      // concurrency guard, so Mercado Pago retrying the event cannot refund twice.
      if (payment.status === 'refunded' || payment.status === 'charged_back') {
        if (sale.status === 'PAGA') {
          try {
            await reverseSale(sale.id, office.id, systemActor(MP_WEBHOOK_ACTOR), {
              reason: `Estorno Mercado Pago: pagamento ${payment.id} com status ${payment.status}`,
              paymentMethod: 'MERCADO_PAGO',
            });
            logger.info('[MP Webhook] Sale reversed', { saleId: sale.id, status: payment.status });
          } catch (error) {
            if (error instanceof CommercialError && error.status === 409) {
              logger.info('[MP Webhook] Reversal already applied or sale changed', { saleId: sale.id });
            } else throw error;
          }
        } else {
          // Nothing was settled on our side, so there is nothing to put back.
          logger.info('[MP Webhook] Refund ignored: sale is not settled', {
            saleId: sale.id, saleStatus: sale.status, paymentStatus: payment.status,
          });
        }
      }
      return NextResponse.json({ success: true });
    }

    if (!authenticated) {
      return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
    }
    // Signature valid but no matching sale/office; acknowledge to stop retries.
    return NextResponse.json({ success: true, ignored: true });
  } catch (error) {
    logger.error('[MP Webhook] Error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
