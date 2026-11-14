import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { decryptToken } from '@/lib/token-encryption';
import { validateMpSignature, fetchMpPayment, type MpPayment } from '@/lib/mercadopago-webhook';
import { toCents } from '@/lib/commercial';
import { readEnv } from '@/lib/env';
import { z } from 'zod';

const notificationSchema = z.object({
  type: z.string().optional(),
  action: z.string().optional(),
  data: z.object({ id: z.union([z.string(), z.number()]) }).optional(),
}).passthrough();

async function processSubscriptionPayment(payment: MpPayment, officeId: string | null) {
  const externalRef = payment.external_reference || '';
  if (!externalRef.startsWith('KITEOS-SUB-')) return { ignored: true };
  const preferenceId = payment.preference_id ? String(payment.preference_id) : null;
  if (!preferenceId) return { ignored: true };

  const subscription = await db.subscription.findFirst({
    where: {
      mpPreferenceId: preferenceId,
      deleted: false,
      ...(officeId ? { officeId } : {}),
    },
  });
  if (!subscription) return { ignored: true };
  if (payment.metadata?.subscriptionId && String(payment.metadata.subscriptionId) !== subscription.id) return { ignored: true };
  if (payment.metadata?.officeId && String(payment.metadata.officeId) !== subscription.officeId) return { ignored: true };

  const paymentId = String(payment.id);
  if (payment.status === 'approved') {
    const paidCents = Math.round(Number(payment.transaction_amount ?? NaN) * 100);
    const expectedCents = toCents(Number(subscription.monthlyPrice));
    if (payment.currency_id !== 'BRL' || !Number.isFinite(paidCents) || paidCents !== expectedCents) {
      await db.auditLog.create({
        data: {
          action: 'SUBSCRIPTION_PAYMENT_AMOUNT_MISMATCH', entity: 'Subscription', entityId: subscription.id,
          details: JSON.stringify({ mpPaymentId: paymentId, expectedCents, paidCents, currency: payment.currency_id }),
          officeId: subscription.officeId,
        },
      });
      return { error: 'Payment amount/currency mismatch', status: 409 };
    }
    if (payment.metadata?.plan && String(payment.metadata.plan) !== subscription.plan) {
      return { error: 'Payment plan mismatch', status: 409 };
    }

    await db.$transaction(async (tx) => {
      // CAS: only the first delivery of this payment activates the subscription.
      const claimed = await tx.subscription.updateMany({
        where: {
          id: subscription.id, officeId: subscription.officeId, deleted: false,
          OR: [{ mpPaymentId: null }, { mpPaymentId: { not: paymentId } }],
        },
        data: { mpPaymentId: paymentId, mpStatus: payment.status },
      });
      if (claimed.count !== 1) return;

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: 'ATIVA', currentPeriodStart: now, currentPeriodEnd: periodEnd },
      });
      await tx.financialEntry.create({
        data: {
          officeId: subscription.officeId, type: 'PAGAR', category: 'ASSINATURA',
          description: `Assinatura Plano ${subscription.plan} - KiteOS (Mercado Pago)`,
          amount: subscription.monthlyPrice, discount: 0, interest: 0, totalAmount: subscription.monthlyPrice,
          status: 'PAGO', dueDate: now, paymentDate: now, paymentMethod: 'MERCADO_PAGO',
          reference: `SUB-MP-${subscription.id}-${paymentId}`,
        },
      });
      await tx.auditLog.create({
        data: {
          action: 'SUBSCRIPTION_PAYMENT_APPROVED', entity: 'Subscription', entityId: subscription.id,
          details: JSON.stringify({ mpPaymentId: paymentId, plan: subscription.plan, amount: Number(subscription.monthlyPrice) }),
          officeId: subscription.officeId,
        },
      });
    });
    return { success: true };
  }

  if (payment.status === 'rejected' || payment.status === 'cancelled') {
    await db.subscription.updateMany({
      where: { id: subscription.id, officeId: subscription.officeId, status: 'PENDENTE', mpPreferenceId: preferenceId },
      data: { mpStatus: payment.status, status: 'INADIMPLENTE' },
    });
  } else {
    await db.subscription.updateMany({
      where: { id: subscription.id, officeId: subscription.officeId, mpPreferenceId: preferenceId },
      data: { mpStatus: payment.status },
    });
  }
  return { success: true };
}

// POST /api/mercadopago/subscription-webhook
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
    const xSignature = request.headers.get('x-signature');
    const xRequestId = request.headers.get('x-request-id');

    // PASSO 6 (CFG-04): antes, um token de plataforma com placeholder fazia a rota
    // cair no laço das oficinas e responder 401 "Invalid signature" quando nenhuma
    // oficina tinha credencial. Configuração ausente era indistinguível de webhook
    // forjado, e o operador procurava atacante onde havia .env incompleto.
    const mercadoPago = readEnv().config.mercadoPago;
    if (mercadoPago.configured && mercadoPago.accessToken) {
      const platformToken = mercadoPago.accessToken;
      const platformSecret = mercadoPago.webhookSecret;
      if (!platformSecret) {
        logger.error('[MP Subscription Webhook] Platform token configured without webhook secret');
        return NextResponse.json(
          { success: false, error: 'Webhook de plataforma sem MP_PLATFORM_WEBHOOK_SECRET', notConfigured: true },
          { status: 503 }
        );
      }
      if (!validateMpSignature({ xSignature, xRequestId, dataId, secret: platformSecret })) {
        return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
      }
      let payment: MpPayment | null;
      try {
        payment = await fetchMpPayment(paymentId, platformToken);
      } catch {
        return NextResponse.json({ success: false, error: 'Payment lookup failed' }, { status: 502 });
      }
      if (!payment) return NextResponse.json({ success: true, ignored: true });
      const result = await processSubscriptionPayment(payment, null);
      if (result.error) return NextResponse.json({ success: false, error: result.error }, { status: result.status || 409 });
      return NextResponse.json({ success: true, ...result });
    }

    // Fallback: office-owned MP accounts. Each office must have its own secret.
    const offices = await db.office.findMany({
      where: { active: true, deleted: false, mpAccessToken: { not: null }, mpWebhookSecret: { not: null } },
      select: { id: true, mpAccessToken: true, mpWebhookSecret: true, mpUserId: true },
    });
    if (offices.length === 0) {
      // Nenhuma credencial em lugar nenhum: 503 com o motivo real. 401 aqui diria
      // "sua assinatura é inválida" para um sistema que nem chegou a ter segredo.
      logger.error('[MP Subscription Webhook] Mercado Pago não configurado: sem token de plataforma e nenhuma oficina com credenciais');
      return NextResponse.json(
        { success: false, error: 'Mercado Pago não configurado', notConfigured: true },
        { status: 503 }
      );
    }
    let authenticated = false;
    for (const office of offices) {
      const secret = decryptToken(office.mpWebhookSecret);
      const token = decryptToken(office.mpAccessToken);
      if (!secret || !token) continue;
      if (!validateMpSignature({ xSignature, xRequestId, dataId, secret })) continue;
      authenticated = true;
      let payment: MpPayment | null;
      try {
        payment = await fetchMpPayment(paymentId, token);
      } catch {
        return NextResponse.json({ success: false, error: 'Payment lookup failed' }, { status: 502 });
      }
      if (!payment) continue;
      if (office.mpUserId && payment.collector_id !== undefined && String(payment.collector_id) !== String(office.mpUserId)) continue;
      const result = await processSubscriptionPayment(payment, office.id);
      if (result.error) return NextResponse.json({ success: false, error: result.error }, { status: result.status || 409 });
      if (!result.ignored) return NextResponse.json({ success: true, ...result });
    }
    if (!authenticated) return NextResponse.json({ success: false, error: 'Invalid signature' }, { status: 401 });
    return NextResponse.json({ success: true, ignored: true });
  } catch (error) {
    logger.error('[MP Subscription Webhook] Error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
