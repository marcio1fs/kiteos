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

const PLAN_HIERARCHY = ['FREE', 'PRO', 'PRO_PLUS', 'PREMIUM'];

// GET /api/subscriptions/[id] - Get subscription details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // AUD-C02 FIX: Added requireAuth — was completely unauthenticated
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { id } = await params;

    const subscription = await db.subscription.findFirst({
      where: {
        id,
        officeId: auth.payload.officeId,
        deleted: false,
      },
      include: {
        office: {
          select: {
            id: true,
            name: true,
            cnpj: true,
            email: true,
          },
        },
      },
    });

    if (!subscription) {
      return NextResponse.json(
        { success: false, error: 'Assinatura não encontrada' },
        { status: 404 }
      );
    }

    // Check if overdue and update status
    const now = new Date();
    if (
      subscription.currentPeriodEnd &&
      subscription.currentPeriodEnd < now &&
      subscription.status === 'ATIVA'
    ) {
      const updated = await db.subscription.update({
        where: { id: subscription.id },
        data: { status: 'INADIMPLENTE' },
        include: {
          office: {
            select: {
              id: true,
              name: true,
              cnpj: true,
              email: true,
            },
          },
        },
      });

      return NextResponse.json({
        success: true,
        data: {
          ...updated,
          planDetails: PLANS[updated.plan] || PLANS.FREE,
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...subscription,
        planDetails: PLANS[subscription.plan] || PLANS.FREE,
      },
    });
  } catch (error) {
    console.error('Error getting subscription:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar assinatura' },
      { status: 500 }
    );
  }
}

// PUT /api/subscriptions/[id] - Update subscription (upgrade/downgrade plan)
// AUD-C02 FIX: Now requires OWNER role — only owners can change subscription plans
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // AUD-C02 FIX: Added requireAuth with OWNER role — was completely unauthenticated
    const auth = await requireAuth(request, undefined, 'OWNER');
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { id } = await params;
    const body = await request.json();
    const { plan, status } = body;

    // Check if subscription exists AND belongs to this user's office
    const existing = await db.subscription.findFirst({
      where: { id, officeId: auth.payload.officeId, deleted: false },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Assinatura não encontrada' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};

    // Handle plan change (upgrade/downgrade)
    if (plan && plan !== existing.plan) {
      if (!PLANS[plan]) {
        return NextResponse.json(
          { success: false, error: `Plano inválido. Planos disponíveis: ${Object.keys(PLANS).join(', ')}` },
          { status: 400 }
        );
      }

      const currentPlanIndex = PLAN_HIERARCHY.indexOf(existing.plan);
      const newPlanIndex = PLAN_HIERARCHY.indexOf(plan);
      const isUpgrade = newPlanIndex > currentPlanIndex;

      const oldPrice = PLANS[existing.plan].price;
      const newPrice = PLANS[plan].price;

      updateData.plan = plan;
      updateData.monthlyPrice = newPrice;

      // Prorate the difference
      if (existing.currentPeriodStart && existing.currentPeriodEnd && newPrice !== oldPrice) {
        const now = new Date();
        const periodStart = new Date(existing.currentPeriodStart);
        const periodEnd = new Date(existing.currentPeriodEnd);

        const totalDays = Math.ceil(
          (periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)
        );
        const daysRemaining = Math.ceil(
          (periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
        );
        const daysUsed = totalDays - daysRemaining;

        if (isUpgrade) {
          // Upgrade: charge prorated difference
          const proratedCredit = (oldPrice / totalDays) * daysUsed;
          const proratedCharge = (newPrice / totalDays) * daysRemaining;
          const amountDue = Math.max(0, proratedCharge - proratedCredit);

          if (amountDue > 0) {
            await db.financialEntry.create({
              data: {
                officeId: existing.officeId,
                type: 'PAGAR',
                category: 'ASSINATURA',
                description: `Upgrade Plano ${existing.plan} → ${plan} - Diferença proporcional`,
                amount: Math.round(amountDue * 100) / 100,
                discount: 0,
                interest: 0,
                totalAmount: Math.round(amountDue * 100) / 100,
                status: 'PENDENTE',
                dueDate: now,
                reference: `UPGRADE-${id}`,
              },
            });
          }
        } else {
          // Downgrade: create credit entry
          const proratedCredit = (oldPrice / totalDays) * daysRemaining;
          const proratedCharge = (newPrice / totalDays) * daysRemaining;
          const creditAmount = proratedCredit - proratedCharge;

          if (creditAmount > 0) {
            await db.financialEntry.create({
              data: {
                officeId: existing.officeId,
                type: 'RECEBER',
                category: 'ASSINATURA',
                description: `Crédito downgrade Plano ${existing.plan} → ${plan} - Diferença proporcional`,
                amount: Math.round(creditAmount * 100) / 100,
                discount: 0,
                interest: 0,
                totalAmount: Math.round(creditAmount * 100) / 100,
                status: 'PENDENTE',
                dueDate: now,
                reference: `DOWNGRADE-${id}`,
              },
            });
          }
        }

        // Update billing period to start from now
        updateData.currentPeriodStart = now;
        const newPeriodEnd = new Date(now);
        newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
        updateData.currentPeriodEnd = newPeriodEnd;
      }
    }

    // Handle status change
    if (status) {
      const validStatuses = ['ATIVA', 'INADIMPLENTE', 'CANCELADA', 'TRIAL', 'PENDENTE'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { success: false, error: `Status inválido. Status válidos: ${validStatuses.join(', ')}` },
          { status: 400 }
        );
      }

      // SEC-09 FIX: Block direct ATIVA status transition via PUT — only webhook should set it
      if (status === 'ATIVA' && existing.status !== 'ATIVA') {
        return NextResponse.json(
          { success: false, error: 'Status ATIVA não pode ser definido manualmente. Apenas o webhook de pagamento pode ativar uma assinatura.' },
          { status: 403 }
        );
      }

      // If cancelling, set endDate
      if (status === 'CANCELADA' && existing.status !== 'CANCELADA') {
        updateData.status = status;
        updateData.endDate = new Date();
      } else {
        updateData.status = status;
      }

      // If reactivating, reset period
      if (status === 'ATIVA' && existing.status === 'INADIMPLENTE') {
        const now = new Date();
        updateData.currentPeriodStart = now;
        const newPeriodEnd = new Date(now);
        newPeriodEnd.setMonth(newPeriodEnd.getMonth() + 1);
        updateData.currentPeriodEnd = newPeriodEnd;
      }
    }

    const subscription = await db.subscription.update({
      where: { id },
      data: updateData,
      include: {
        office: {
          select: {
            id: true,
            name: true,
            cnpj: true,
            email: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        ...subscription,
        planDetails: PLANS[subscription.plan] || PLANS.FREE,
      },
    });
  } catch (error) {
    console.error('Error updating subscription:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar assinatura' },
      { status: 500 }
    );
  }
}
