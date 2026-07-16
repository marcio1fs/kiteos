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
      planDetails: PLANS[sub.plan] || PLANS.FREE,
    }));

    return NextResponse.json({
      success: true,
      data: enrichedSubscriptions,
    });
  } catch (error) {
    console.error('Error listing subscriptions: [REDACTED]');
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

    if (!plan || !PLANS[plan]) {
      return NextResponse.json(
        { success: false, error: `Plano inválido. Planos disponíveis: ${Object.keys(PLANS).join(', ')}` },
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
    const planDetails = PLANS[plan];
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
    console.error('Error creating subscription: [REDACTED]');
    return NextResponse.json(
      { success: false, error: 'Erro ao criar assinatura' },
      { status: 500 }
    );
  }
}
