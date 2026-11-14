import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { getPlan } from '@/lib/plans';


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
          planDetails: getPlan(updated.plan),
        },
      });
    }

    return NextResponse.json({
      success: true,
      data: {
        ...subscription,
        planDetails: getPlan(subscription.plan),
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

// PUT /api/subscriptions/[id] - Tenant owners may cancel; plan changes require checkout.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request, undefined, 'OWNER');
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }
    const { id } = await params;
    const body = await request.json();
    const existing = await db.subscription.findFirst({ where: { id, officeId: auth.payload.officeId, deleted: false } });
    if (!existing) return NextResponse.json({ success: false, error: 'Assinatura não encontrada' }, { status: 404 });

    if (body.plan !== undefined && body.plan !== existing.plan) {
      return NextResponse.json({
        success: false,
        error: 'Alterações de plano devem ser feitas pelo checkout de pagamento. Use /api/mercadopago/create-subscription.',
      }, { status: 403 });
    }
    if (body.status !== undefined && body.status !== 'CANCELADA') {
      return NextResponse.json({ success: false, error: 'Apenas o cancelamento pode ser solicitado por este endpoint' }, { status: 403 });
    }

    const subscription = await db.subscription.update({
      where: { id, officeId: auth.payload.officeId },
      data: { status: 'CANCELADA', endDate: new Date() },
      include: { office: { select: { id: true, name: true, cnpj: true, email: true } } },
    });
    return NextResponse.json({ success: true, data: { ...subscription, planDetails: getPlan(subscription.plan) } });
  } catch (error) {
    console.error('Error updating subscription:', error instanceof Error ? error.message : error);
    return NextResponse.json({ success: false, error: 'Erro ao atualizar assinatura' }, { status: 500 });
  }
}
