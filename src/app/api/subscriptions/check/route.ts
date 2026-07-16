import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// Plan definitions
const PLANS: Record<string, {
  maxOS: number;
  maxClients: number;
  maxParts: number;
  aiAccess: boolean;
  whatsapp: boolean;
  price: number;
}> = {
  FREE: { maxOS: 10, maxClients: 20, maxParts: 50, aiAccess: false, whatsapp: false, price: 0 },
  PRO: { maxOS: 100, maxClients: 200, maxParts: 500, aiAccess: true, whatsapp: false, price: 99.90 },
  PRO_PLUS: { maxOS: 500, maxClients: 1000, maxParts: 2000, aiAccess: true, whatsapp: true, price: 199.90 },
  PREMIUM: { maxOS: -1, maxClients: -1, maxParts: -1, aiAccess: true, whatsapp: true, price: 349.90 },
};

// GET /api/subscriptions/check - Check if office has active subscription
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    if (officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Find active, trial, pending, or overdue subscription
    const subscription = await db.subscription.findFirst({
      where: {
        officeId,
        deleted: false,
        status: { in: ['ATIVA', 'TRIAL', 'INADIMPLENTE', 'PENDENTE'] },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // If no subscription, return free plan as default
    if (!subscription) {
      // Auto-create FREE subscription for the office
      const now = new Date();

      // Generate subscription code
      const { randomBytes } = await import('crypto');
      const subscriptionCode = `KIT-${randomBytes(4).toString('hex').toUpperCase()}`;

      const freeSubscription = await db.subscription.create({
        data: {
          officeId,
          plan: 'FREE',
          status: 'ATIVA',
          subscriptionCode,
          startDate: now,
          monthlyPrice: 0,
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getFullYear(), now.getMonth() + 1, 1),
        },
      });

      // Get current usage for limit checks
      const [currentOS, currentClients, currentParts] = await Promise.all([
        db.serviceOrder.count({
          where: { officeId, deleted: false, createdAt: { gte: now } },
        }),
        db.client.count({
          where: { officeId, deleted: false },
        }),
        db.part.count({
          where: { officeId, deleted: false },
        }),
      ]);

      return NextResponse.json({
        success: true,
        data: {
          hasSubscription: true,
          subscription: freeSubscription,
          planDetails: PLANS.FREE,
          features: {
            maxOS: PLANS.FREE.maxOS,
            maxClients: PLANS.FREE.maxClients,
            maxParts: PLANS.FREE.maxParts,
            aiAccess: PLANS.FREE.aiAccess,
            whatsapp: PLANS.FREE.whatsapp,
          },
          billingStatus: freeSubscription.status,
          isOverdue: false,
          currentUsage: {
            os: currentOS,
            clients: currentClients,
            parts: currentParts,
          },
          limitsReached: {
            os: PLANS.FREE.maxOS !== -1 && currentOS >= PLANS.FREE.maxOS,
            clients: PLANS.FREE.maxClients !== -1 && currentClients >= PLANS.FREE.maxClients,
            parts: PLANS.FREE.maxParts !== -1 && currentParts >= PLANS.FREE.maxParts,
          },
        },
      });
    }

    // Check if overdue (currentPeriodEnd < today)
    const now = new Date();
    let isOverdue = false;

    if (
      subscription.currentPeriodEnd &&
      subscription.currentPeriodEnd < now &&
      subscription.status === 'ATIVA'
    ) {
      isOverdue = true;
      // Mark as INADIMPLENTE
      await db.subscription.update({
        where: { id: subscription.id },
        data: { status: 'INADIMPLENTE' },
      });
      subscription.status = 'INADIMPLENTE';
    }

    // Check if trial has expired
    if (
      subscription.status === 'TRIAL' &&
      subscription.trialEndDate &&
      subscription.trialEndDate < now
    ) {
      // Downgrade to FREE when trial expires
      await db.subscription.update({
        where: { id: subscription.id },
        data: {
          status: 'ATIVA',
          plan: 'FREE',
          monthlyPrice: 0,
        },
      });
      subscription.plan = 'FREE';
      subscription.monthlyPrice = new (await import('@prisma/client/runtime/library')).Decimal(0);
      subscription.status = 'ATIVA';
    }

    // For PENDENTE status - subscription is awaiting MP payment confirmation
    // The plan is NOT active yet - use FREE plan limits until payment is confirmed
    let effectivePlan = subscription.plan;
    let effectivePlanDetails = PLANS[subscription.plan] || PLANS.FREE;
    let isPendingPayment = false;

    if (subscription.status === 'PENDENTE') {
      // While payment is pending, the office only has FREE plan access
      effectivePlan = 'FREE';
      effectivePlanDetails = PLANS.FREE;
      isPendingPayment = true;
    }

    const planDetails = effectivePlanDetails;

    // Get current usage for limit checks
    const periodStart = subscription.currentPeriodStart || subscription.startDate;
    const [currentOS, currentClients, currentParts] = await Promise.all([
      db.serviceOrder.count({
        where: {
          officeId,
          deleted: false,
          ...(periodStart && {
            createdAt: {
              gte: periodStart,
            },
          }),
        },
      }),
      db.client.count({
        where: {
          officeId,
          deleted: false,
        },
      }),
      db.part.count({
        where: {
          officeId,
          deleted: false,
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        hasSubscription: true,
        subscription,
        planDetails,
        features: {
          maxOS: planDetails.maxOS,
          maxClients: planDetails.maxClients,
          maxParts: planDetails.maxParts,
          aiAccess: planDetails.aiAccess,
          whatsapp: planDetails.whatsapp,
        },
        billingStatus: subscription.status,
        isOverdue,
        isPendingPayment,
        pendingPlan: isPendingPayment ? subscription.plan : null,
        currentUsage: {
          os: currentOS,
          clients: currentClients,
          parts: currentParts,
        },
        limitsReached: {
          os: planDetails.maxOS !== -1 && currentOS >= planDetails.maxOS,
          clients: planDetails.maxClients !== -1 && currentClients >= planDetails.maxClients,
          parts: planDetails.maxParts !== -1 && currentParts >= planDetails.maxParts,
        },
      },
    });
  } catch (error) {
    console.error('Error checking subscription:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao verificar assinatura' },
      { status: 500 }
    );
  }
}
