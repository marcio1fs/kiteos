import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { PLANS, PLAN_KEYS, getPlan, isPlanKey } from '@/lib/plans';

// GET /api/subscriptions - List subscriptions for office
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
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const subscriptions = await db.subscription.findMany({
      where: {
        officeId,
        deleted: false,
      },
      include: {
        office: {
          select: {
            id: true,
            name: true,
            cnpj: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // Add plan details to each subscription
    const enrichedSubscriptions = subscriptions.map((sub) => ({
      ...sub,
      planDetails: getPlan(sub.plan),
    }));

    return NextResponse.json({
      success: true,
      data: enrichedSubscriptions,
    });
  } catch (error) {
    logger.error('Error listing subscriptions: [REDACTED]', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao listar assinaturas' },
      { status: 500 }
    );
  }
}

// POST /api/subscriptions - Create subscription
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      officeId,
      plan,
      startDate,
      trialEndDate,
    } = body;

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

    // ============================================================================
    // SECURITY FIX: Only ADMIN or OWNER can create subscriptions
    // EMPLOYEE should not be able to change plans (financial impact)
    // ============================================================================
    if (auth.payload.role === 'EMPLOYEE') {
      return NextResponse.json(
        { success: false, error: 'Funcionários não podem criar assinaturas' },
        { status: 403 }
      );
    }

    if (!isPlanKey(plan)) {
      return NextResponse.json(
        { success: false, error: `Plano inválido. Planos disponíveis: ${PLAN_KEYS.join(', ')}` },
        { status: 400 }
      );
    }

    // SECURITY FIX (#74): Application-level uniqueness check (replaces removed @@unique([officeId]))
    // The DB constraint was removed because it blocked new subscriptions after soft-delete.
    // This check enforces: only one active (non-deleted) subscription per office.
    const existingSubscription = await db.subscription.findFirst({
      where: {
        officeId,
        deleted: false,
      },
    });

    if (existingSubscription) {
      return NextResponse.json(
        { success: false, error: 'Já existe uma assinatura ativa para esta oficina' },
        { status: 409 }
      );
    }

    const now = new Date();
    const planDetails = getPlan(plan);
    const startDateObj = startDate ? new Date(startDate) : now;
    const isTrial = !!trialEndDate;

    // Calculate billing period
    const currentPeriodStart = startDateObj;
    const currentPeriodEnd = new Date(startDateObj);
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);

    // Calculate end date (null for ongoing subscriptions)
    const endDate = plan === 'FREE' ? null : null; // Ongoing until cancelled

    // Generate subscription code: KIT-XXXXXXXX
    const { randomBytes } = await import('crypto');
    const subscriptionCode = `KIT-${randomBytes(4).toString('hex').toUpperCase()}`;

    const subscription = await db.subscription.create({
      data: {
        officeId,
        plan,
        status: isTrial ? 'TRIAL' : 'ATIVA',
        subscriptionCode,
        startDate: startDateObj,
        endDate,
        trialEndDate: trialEndDate ? new Date(trialEndDate) : null,
        monthlyPrice: planDetails.price,
        currentPeriodStart,
        currentPeriodEnd,
      },
      include: {
        office: {
          select: {
            id: true,
            name: true,
            cnpj: true,
          },
        },
      },
    });

    // Generate financial entry automatically for paid plans
    if (planDetails.price > 0) {
      await db.financialEntry.create({
        data: {
          officeId,
          type: 'PAGAR',
          category: 'ASSINATURA',
          description: `Assinatura Plano ${plan} - KiteOS`,
          amount: planDetails.price,
          discount: 0,
          interest: 0,
          totalAmount: planDetails.price,
          status: 'PENDENTE',
          dueDate: currentPeriodEnd,
          reference: `SUB-${subscription.id}`,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...subscription,
        planDetails,
      },
    });
  } catch (error) {
    logger.error('Error creating subscription: [REDACTED]', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao criar assinatura' },
      { status: 500 }
    );
  }
}
