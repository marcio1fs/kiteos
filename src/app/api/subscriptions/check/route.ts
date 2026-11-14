import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';
import { buildPlanStatus, resolveEffectivePlan } from '@/lib/plans';

/**
 * GET /api/subscriptions/check
 *
 * Reports the plan whose limits are actually enforced by the API. The policy
 * lives in `@/lib/plans` so this endpoint and the creation guards can never
 * disagree about what an office is allowed to do.
 *
 * This handler still performs billing housekeeping (auto-provision FREE, flag
 * overdue periods, downgrade expired trials) because there is no background job
 * doing it. Those writes happen before the limits are computed so the response
 * reflects the post-housekeeping state.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');

    if (!officeId) {
      return NextResponse.json({ success: false, error: 'officeId é obrigatório' }, { status: 400 });
    }

    if (officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    const office = await db.office.findFirst({ where: { id: officeId, deleted: false }, select: { id: true } });
    if (!office) {
      return NextResponse.json({ success: false, error: 'Oficina não encontrada' }, { status: 404 });
    }

    const now = new Date();
    let current = await resolveEffectivePlan(db, officeId, now);

    // Auto-provision a FREE subscription so every office has a billing record.
    if (!current.subscriptionId) {
      const subscriptionCode = `KIT-${randomBytes(4).toString('hex').toUpperCase()}`;
      await db.subscription.create({
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
      current = await resolveEffectivePlan(db, officeId, now);
    }

    const subscription = await db.subscription.findFirst({
      where: { id: current.subscriptionId ?? undefined, officeId, deleted: false },
    });

    if (subscription) {
      // Period elapsed without a confirmed payment → flag as overdue. The plan
      // limits are kept (grace) so the office can keep billing while it settles.
      if (
        subscription.status === 'ATIVA' &&
        subscription.currentPeriodEnd &&
        subscription.currentPeriodEnd < now
      ) {
        await db.subscription.update({
          where: { id: subscription.id },
          data: { status: 'INADIMPLENTE' },
        });
        subscription.status = 'INADIMPLENTE';
      }

      // Expired trial falls back to FREE for real, not only for this response.
      if (subscription.status === 'TRIAL' && subscription.trialEndDate && subscription.trialEndDate < now) {
        await db.subscription.update({
          where: { id: subscription.id },
          data: { status: 'ATIVA', plan: 'FREE', monthlyPrice: 0 },
        });
        subscription.status = 'ATIVA';
        subscription.plan = 'FREE';
        subscription.monthlyPrice = new Prisma.Decimal(0);
      }
    }

    // Re-resolve after housekeeping so the reported limits match enforcement.
    // buildPlanStatus resolves the effective plan and counts usage in one pass.
    const status = await buildPlanStatus(db, officeId, now);
    const effective = status.effective;

    return NextResponse.json({
      success: true,
      data: {
        hasSubscription: true,
        subscription: subscription ?? null,
        planDetails: status.planDetails,
        features: status.features,
        billingStatus: effective.status,
        isOverdue: effective.isOverdue,
        isPendingPayment: effective.isPendingPayment,
        pendingPlan: effective.isPendingPayment ? effective.subscribedPlan : null,
        /** Limits in force may be lower than the subscribed plan; say why. */
        subscribedPlan: effective.subscribedPlan,
        effectivePlan: effective.plan.key,
        fallbackReason: effective.reason,
        currentUsage: status.currentUsage,
        limitsReached: status.limitsReached,
      },
    });
  } catch (error) {
    logger.error('Error checking subscription:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao verificar assinatura' }, { status: 500 });
  }
}
