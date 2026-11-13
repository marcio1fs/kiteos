import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import MercadoPagoConfig, { Preference } from 'mercadopago';
import { randomBytes } from 'crypto';
import { decryptToken } from '@/lib/token-encryption';
import { PLANS, PLAN_KEYS, getPlan, isPlanKey } from '@/lib/plans';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

// POST /api/mercadopago/create-subscription - Create MP payment preference for subscription
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, plan } = body;

    // Validations
    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    if (!isPlanKey(plan) || plan === 'FREE') {
      return NextResponse.json(
        { success: false, error: 'Plano inválido. Selecione um plano pago.' },
        { status: 400 }
      );
    }

    const planDetails = getPlan(plan);

    // Get office info
    const office = await db.office.findUnique({
      where: { id: officeId },
      include: { users: { where: { role: 'OWNER', deleted: false }, take: 1 } },
    });

    if (!office) {
      return NextResponse.json(
        { success: false, error: 'Oficina não encontrada' },
        { status: 404 }
      );
    }

    // Check for existing active subscription
    const existingSub = await db.subscription.findFirst({
      where: {
        officeId,
        deleted: false,
        status: { in: ['ATIVA', 'TRIAL', 'INADIMPLENTE', 'PENDENTE'] },
      },
    });

    // If already on the same plan, don't allow
    if (existingSub && existingSub.plan === plan && existingSub.status === 'ATIVA') {
      return NextResponse.json(
        { success: false, error: 'Você já está neste plano.' },
        { status: 400 }
      );
    }

    // Get MP platform access token
    const mpAccessToken = process.env.MP_PLATFORM_ACCESS_TOKEN;
    if (!mpAccessToken || mpAccessToken.includes('xxxxxxxx')) {
      // If no platform token configured, try using the office's own MP token
      if (!office.mpAccessToken || !office.mpEnabled) {
        return NextResponse.json(
          { success: false, error: 'Mercado Pago não configurado. Configure o Access Token nas configurações da oficina para assinar planos pagos.', requiresConfig: true },
          { status: 400 }
        );
      }
    }

    const officeToken = decryptToken(office.mpAccessToken);
    const accessToken = (mpAccessToken && !mpAccessToken.includes('xxxxxxxx'))
      ? mpAccessToken
      : officeToken;
    if (!accessToken) {
      return NextResponse.json({ success: false, error: 'Token do Mercado Pago não configurado ou inválido' }, { status: 400 });
    }

    // Generate a unique reference for this subscription payment
    const paymentRef = `KITEOS-SUB-${officeId.slice(-8)}-${plan}-${Date.now()}`;

    // Create or find pending subscription to track the payment
    let subscriptionId: string;

    if (existingSub) {
      // Update existing subscription with the new plan info and MP status
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const updated = await db.subscription.update({
        where: { id: existingSub.id },
        data: {
          plan,
          status: 'PENDENTE', // Awaiting payment - will be ATIVA only after webhook confirms
          monthlyPrice: planDetails.price,
          mpStatus: 'pending',
          mpPreferenceId: null, // Will be updated after preference creation
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });
      subscriptionId = updated.id;
    } else {
      // Create new subscription
      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);

      const subscriptionCode = `KIT-${randomBytes(4).toString('hex').toUpperCase()}`;
      const created = await db.subscription.create({
        data: {
          officeId,
          plan,
          status: 'PENDENTE', // Awaiting MP payment confirmation - only ATIVA after webhook approves
          subscriptionCode,
          startDate: now,
          monthlyPrice: planDetails.price,
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          mpStatus: 'pending',
        },
      });
      subscriptionId = created.id;
    }

    // Configure Mercado Pago SDK
    const client = new MercadoPagoConfig({ accessToken });
    const preference = new Preference(client);

    // Get payer info from office
    const payer = office.users[0] || null;
    const payerEmail = payer?.email || office.email;
    const payerName = payer?.name || office.name;

    // Create preference for subscription payment
    const preferenceBody = {
      items: [
        {
          id: `plan_${plan.toLowerCase()}`,
          title: `KiteOS - Plano ${planDetails.label}`,
          description: `Assinatura mensal do plano ${planDetails.label} - Sistema de gestão para oficinas`,
          unit_price: planDetails.price,
          quantity: 1,
          currency_id: 'BRL' as const,
          category_id: 'S09',
        },
      ],
      payer: {
        name: payerName.split(' ')[0],
        surname: payerName.split(' ').slice(1).join(' ') || 'N/A',
        email: payerEmail,
        identification: office.cnpj ? {
          type: 'CNPJ',
          number: office.cnpj.replace(/\D/g, ''),
        } : undefined,
      },
      back_urls: {
        success: `${APP_URL}/api/mercadopago/subscription-return?status=success&subscriptionId=${subscriptionId}`,
        failure: `${APP_URL}/api/mercadopago/subscription-return?status=failure&subscriptionId=${subscriptionId}`,
        pending: `${APP_URL}/api/mercadopago/subscription-return?status=pending&subscriptionId=${subscriptionId}`,
      },
      notification_url: `${APP_URL}/api/mercadopago/subscription-webhook`,
      external_reference: paymentRef,
      statement_descriptor: 'KITEOS',
      metadata: {
        officeId,
        subscriptionId,
        plan,
        type: 'subscription',
      },
    };

    let result;
    try {
      // First try with auto_return (requires valid back_urls)
      result = await preference.create({ body: { ...preferenceBody, auto_return: 'approved' as const } });
    } catch (firstError: unknown) {
      logger.warn('[MP Create] auto_return failed, trying without it', { error: firstError instanceof Error ? firstError.message : String(firstError) });
      // If auto_return fails (e.g., back_urls not validated by MP), try without it
      result = await preference.create({ body: preferenceBody });
    }

    // Update subscription with MP preference ID
    await db.subscription.update({
      where: { id: subscriptionId },
      data: {
        mpPreferenceId: result.id,
      },
    });

    // Determine the checkout URL
    const isSandbox = (mpAccessToken && !mpAccessToken.includes('xxxxxxxx'))
      ? mpAccessToken.startsWith('TEST-')
      : (office.mpSandbox ?? true);

    const checkoutUrl = isSandbox
      ? result.sandbox_init_point
      : result.init_point;

    return NextResponse.json({
      success: true,
      data: {
        mpPreferenceId: result.id,
        checkoutUrl,
        sandboxMode: isSandbox,
        subscriptionId,
        plan,
        price: planDetails.price,
      },
    });
  } catch (error: unknown) {
    logger.error('Error creating subscription payment', { error: error instanceof Error ? error.message : String(error) });

    // Check for MP API specific errors
    let errMsg = 'Erro ao criar pagamento de assinatura';
    if (error && typeof error === 'object' && 'message' in error) {
      const mpError = error as { message?: string; code?: string };
      if (mpError.message?.includes('invalid access token') || mpError.code === 'unauthorized') {
        errMsg = 'Access Token do Mercado Pago inválido ou expirado. Configure um token válido no Perfil da Oficina.';
      } else if (mpError.message) {
        errMsg = mpError.message;
      }
    }

    return NextResponse.json(
      { success: false, error: errMsg },
      { status: 500 }
    );
  }
}
