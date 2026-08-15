import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';

// GET /api/financial/dashboard - Get financial dashboard data for an office
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

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Auto-update overdue entries first
    await db.financialEntry.updateMany({
      where: {
        officeId,
        deleted: false,
        status: 'PENDENTE',
        dueDate: { lt: now },
      },
      data: {
        status: 'ATRASADO',
      },
    });

    // Total contas a receber (pending)
    const contasReceberPendentes = await db.financialEntry.aggregate({
      where: {
        officeId,
        deleted: false,
        type: 'RECEBER',
        status: { in: ['PENDENTE', 'ATRASADO'] },
      },
      _sum: {
        totalAmount: true,
      },
    });

    // Total contas a pagar (pending)
    const contasPagarPendentes = await db.financialEntry.aggregate({
      where: {
        officeId,
        deleted: false,
        type: 'PAGAR',
        status: { in: ['PENDENTE', 'ATRASADO'] },
      },
      _sum: {
        totalAmount: true,
      },
    });

    // Total received this month
    const totalRecebidoMes = await db.financialEntry.aggregate({
      where: {
        officeId,
        deleted: false,
        type: 'RECEBER',
        status: 'PAGO',
        paymentDate: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _sum: {
        totalAmount: true,
      },
    });

    // Total paid this month
    const totalPagoMes = await db.financialEntry.aggregate({
      where: {
        officeId,
        deleted: false,
        type: 'PAGAR',
        status: 'PAGO',
        paymentDate: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _sum: {
        totalAmount: true,
      },
    });

    // Entries by category
    const entriesByCategory = await db.financialEntry.groupBy({
      by: ['category', 'type'],
      where: {
        officeId,
        deleted: false,
      },
      _sum: {
        totalAmount: true,
        amount: true,
      },
      _count: {
        id: true,
      },
    });

    // Cash flow summary - daily for last 30 days
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const cashFlowEntries = await db.financialEntry.findMany({
      where: {
        officeId,
        deleted: false,
        status: 'PAGO',
        paymentDate: {
          gte: thirtyDaysAgo,
          lte: now,
        },
      },
      select: {
        type: true,
        totalAmount: true,
        paymentDate: true,
      },
      orderBy: {
        paymentDate: 'asc',
      },
    });

    // Group cash flow by day
    const cashFlowByDay: Record<string, { receitas: number; despesas: number; saldo: number }> = {};
    for (const entry of cashFlowEntries) {
      if (!entry.paymentDate) continue;
      const dayKey = entry.paymentDate.toISOString().split('T')[0];
      if (!cashFlowByDay[dayKey]) {
        cashFlowByDay[dayKey] = { receitas: 0, despesas: 0, saldo: 0 };
      }
      if (entry.type === 'RECEBER') {
        cashFlowByDay[dayKey].receitas += Number(entry.totalAmount);
      } else {
        cashFlowByDay[dayKey].despesas += Number(entry.totalAmount);
      }
      cashFlowByDay[dayKey].saldo = cashFlowByDay[dayKey].receitas - cashFlowByDay[dayKey].despesas;
    }

    // Convert to array and sort
    const cashFlowSummary = Object.entries(cashFlowByDay)
      .map(([date, data]) => ({
        date,
        ...data,
        receitas: Math.round(data.receitas * 100) / 100,
        despesas: Math.round(data.despesas * 100) / 100,
        saldo: Math.round(data.saldo * 100) / 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Overdue entries count
    const overdueCount = await db.financialEntry.count({
      where: {
        officeId,
        deleted: false,
        status: 'ATRASADO',
      },
    });

    // Pending entries count
    const pendingCount = await db.financialEntry.count({
      where: {
        officeId,
        deleted: false,
        status: 'PENDENTE',
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        contasReceberPendentes: Number(contasReceberPendentes._sum.totalAmount || 0),
        contasPagarPendentes: Number(contasPagarPendentes._sum.totalAmount || 0),
        totalRecebidoMes: Number(totalRecebidoMes._sum.totalAmount || 0),
        totalPagoMes: Number(totalPagoMes._sum.totalAmount || 0),
        saldoMes: Number(totalRecebidoMes._sum.totalAmount || 0) - Number(totalPagoMes._sum.totalAmount || 0),
        overdueCount,
        pendingCount,
        entriesByCategory: entriesByCategory.map((item) => ({
          category: item.category,
          type: item.type,
          totalAmount: Number(item._sum.totalAmount || 0),
          amount: Number(item._sum.amount || 0),
          count: item._count.id,
        })),
        cashFlowSummary,
      },
    });
  } catch (error) {
    logger.error('Error getting financial dashboard:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar dados do dashboard financeiro' },
      { status: 500 }
    );
  }
}
