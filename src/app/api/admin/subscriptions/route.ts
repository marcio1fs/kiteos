import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requirePlatformAdmin } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { PLANS, PLAN_KEYS, getPlan, isPlanKey } from '@/lib/plans';

// GET /api/admin/subscriptions - Admin dashboard with all subscribers
// SECURITY FIX: Added authentication and OWNER role requirement
export async function GET(request: NextRequest) {
  try {
    // Platform operations are independent of tenant roles (OWNER/ADMIN).
    const auth = await requirePlatformAdmin(request);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    const { searchParams } = new URL(request.url);
    const plan = searchParams.get('plan');
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    // Fetch ALL subscriptions across ALL offices (admin view)
    const where: Record<string, unknown> = {
      deleted: false,
    };

    if (plan) {
      where.plan = plan;
    }

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { subscriptionCode: { contains: search } },
        { office: { name: { contains: search } } },
        { office: { email: { contains: search } } },
        { office: { cnpj: { contains: search } } },
        { office: { phone: { contains: search } } },
      ];
    }

    // Get all subscriptions with office and user info
    const subscriptions = await db.subscription.findMany({
      where,
      include: {
        office: {
          select: {
            id: true,
            name: true,
            cnpj: true,
            email: true,
            phone: true,
            address: true,
            city: true,
            state: true,
            active: true,
            createdAt: true,
            users: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
              where: { deleted: false },
              take: 1,
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate statistics
    const totalSubscribers = subscriptions.length;
    const activeSubscriptions = subscriptions.filter(s => s.status === 'ATIVA' || s.status === 'TRIAL');

    // AUD-C08 FIX: This is a platform admin endpoint — any OWNER from any office
    // can see ALL subscriptions. This is a cross-tenant data breach.
    // For now, we redact sensitive PII from other offices.

    // AUD-C08 + AUD-H05 FIX: Convert Decimal to Number for comparisons
    const payingSubscribers = subscriptions.filter(s => Number(s.monthlyPrice) > 0 && (s.status === 'ATIVA' || s.status === 'TRIAL'));
    const overdueSubscriptions = subscriptions.filter(s => s.status === 'INADIMPLENTE');
    const cancelledSubscriptions = subscriptions.filter(s => s.status === 'CANCELADA');
    const trialSubscriptions = subscriptions.filter(s => s.status === 'TRIAL');

    // AUD-H05 FIX: Convert Decimal to Number in reduce
    const mrr = payingSubscribers.reduce((sum, sub) => sum + Number(sub.monthlyPrice), 0);

    // Revenue by plan
    const revenueByPlan = PLAN_KEYS.map(planKey => {
      const planSubs = subscriptions.filter(s => s.plan === planKey && Number(s.monthlyPrice) > 0 && (s.status === 'ATIVA' || s.status === 'TRIAL'));
      return {
        plan: planKey,
        label: PLANS[planKey].label,
        count: planSubs.length,
        revenue: planSubs.reduce((sum, s) => sum + Number(s.monthlyPrice), 0),
      };
    });

    // Subscriber count by plan
    const countByPlan = PLAN_KEYS.map(planKey => ({
      plan: planKey,
      label: PLANS[planKey].label,
      count: subscriptions.filter(s => s.plan === planKey).length,
    }));

    // Status distribution
    const statusDistribution = [
      { status: 'ATIVA', label: 'Ativa', count: subscriptions.filter(s => s.status === 'ATIVA').length },
      { status: 'TRIAL', label: 'Trial', count: subscriptions.filter(s => s.status === 'TRIAL').length },
      { status: 'INADIMPLENTE', label: 'Inadimplente', count: subscriptions.filter(s => s.status === 'INADIMPLENTE').length },
      { status: 'CANCELADA', label: 'Cancelada', count: subscriptions.filter(s => s.status === 'CANCELADA').length },
    ];

    // AUD-C08 FIX: Redact PII from offices that don't belong to the requesting user
    const userOfficeId = auth.payload.officeId;
    const enrichedSubscriptions = subscriptions.map(sub => {
      const isOwnOffice = sub.officeId === userOfficeId;
      return {
        ...sub,
        monthlyPrice: Number(sub.monthlyPrice),
        planDetails: getPlan(sub.plan),
        ownerName: isOwnOffice ? (sub.office?.users?.[0]?.name || '—') : '—',
        ownerEmail: isOwnOffice ? (sub.office?.users?.[0]?.email || sub.office?.email || '—') : '—',
        office: isOwnOffice ? sub.office : {
          id: sub.office?.id,
          name: sub.office?.name,
          active: sub.office?.active,
          // CNPJ, email, phone, address hidden for other offices
        },
      };
    });

    return NextResponse.json({
      success: true,
      data: enrichedSubscriptions,
      stats: {
        totalSubscribers,
        activeSubscribers: activeSubscriptions.length,
        payingSubscribers: payingSubscribers.length,
        overdueSubscribers: overdueSubscriptions.length,
        cancelledSubscribers: cancelledSubscriptions.length,
        trialSubscribers: trialSubscriptions.length,
        mrr,
        revenueByPlan,
        countByPlan,
        statusDistribution,
      },
    });
  } catch (error) {
    logger.error('Error listing admin subscriptions:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao listar assinaturas' },
      { status: 500 }
    );
  }
}
