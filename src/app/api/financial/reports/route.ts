import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// GET /api/financial/reports - Generate financial reports
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const period = searchParams.get('period') || 'monthly'; // daily, monthly, yearly
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

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

    if (!['daily', 'monthly', 'yearly'].includes(period)) {
      return NextResponse.json(
        { success: false, error: 'period deve ser daily, monthly ou yearly' },
        { status: 400 }
      );
    }

    // Build date filter
    const where: Record<string, unknown> = {
      officeId,
      deleted: false,
    };

    const dateFilter: Record<string, unknown> = {};
    if (dateFrom) {
      dateFilter.gte = new Date(dateFrom);
    }
    if (dateTo) {
      dateFilter.lte = new Date(dateTo);
    }
    if (Object.keys(dateFilter).length > 0) {
      where.dueDate = dateFilter;
    }

    // Fetch all entries within the period
    const entries = await db.financialEntry.findMany({
      where,
      include: {
        supplier: {
          select: {
            id: true,
            razaoSocial: true,
          },
        },
      },
      orderBy: {
        dueDate: 'asc',
      },
    });

    // Helper function to get period key from date
    function getPeriodKey(date: Date): string {
      const d = new Date(date);
      switch (period) {
        case 'daily':
          return d.toISOString().split('T')[0]; // YYYY-MM-DD
        case 'monthly':
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; // YYYY-MM
        case 'yearly':
          return `${d.getFullYear()}`; // YYYY
        default:
          return d.toISOString().split('T')[0];
      }
    }

    // Group data by period and category
    interface PeriodData {
      period: string;
      categories: Record<string, {
        amount: number;
        discount: number;
        interest: number;
        totalAmount: number;
        count: number;
      }>;
      totals: {
        amount: number;
        discount: number;
        interest: number;
        totalAmount: number;
        count: number;
      };
      byType: {
        PAGAR: { amount: number; totalAmount: number; count: number };
        RECEBER: { amount: number; totalAmount: number; count: number };
      };
    }

    const grouped: Record<string, PeriodData> = {};

    for (const entry of entries) {
      const periodKey = getPeriodKey(entry.dueDate);
      if (!grouped[periodKey]) {
        grouped[periodKey] = {
          period: periodKey,
          categories: {},
          totals: { amount: 0, discount: 0, interest: 0, totalAmount: 0, count: 0 },
          byType: {
            PAGAR: { amount: 0, totalAmount: 0, count: 0 },
            RECEBER: { amount: 0, totalAmount: 0, count: 0 },
          },
        };
      }

      const cat = entry.category || 'OUTROS';
      if (!grouped[periodKey].categories[cat]) {
        grouped[periodKey].categories[cat] = { amount: 0, discount: 0, interest: 0, totalAmount: 0, count: 0 };
      }

      // Update category totals
      grouped[periodKey].categories[cat].amount += Number(entry.amount);
      grouped[periodKey].categories[cat].discount += Number(entry.discount);
      grouped[periodKey].categories[cat].interest += Number(entry.interest);
      grouped[periodKey].categories[cat].totalAmount += Number(entry.totalAmount);
      grouped[periodKey].categories[cat].count += 1;

      // Update period totals
      grouped[periodKey].totals.amount += Number(entry.amount);
      grouped[periodKey].totals.discount += Number(entry.discount);
      grouped[periodKey].totals.interest += Number(entry.interest);
      grouped[periodKey].totals.totalAmount += Number(entry.totalAmount);
      grouped[periodKey].totals.count += 1;

      // Update by type
      if (entry.type === 'PAGAR') {
        grouped[periodKey].byType.PAGAR.amount += Number(entry.amount);
        grouped[periodKey].byType.PAGAR.totalAmount += Number(entry.totalAmount);
        grouped[periodKey].byType.PAGAR.count += 1;
      } else {
        grouped[periodKey].byType.RECEBER.amount += Number(entry.amount);
        grouped[periodKey].byType.RECEBER.totalAmount += Number(entry.totalAmount);
        grouped[periodKey].byType.RECEBER.count += 1;
      }
    }

    // Convert to sorted array and round values
    const reportData = Object.values(grouped)
      .sort((a, b) => a.period.localeCompare(b.period))
      .map((periodData) => ({
        ...periodData,
        totals: {
          amount: Math.round(periodData.totals.amount * 100) / 100,
          discount: Math.round(periodData.totals.discount * 100) / 100,
          interest: Math.round(periodData.totals.interest * 100) / 100,
          totalAmount: Math.round(periodData.totals.totalAmount * 100) / 100,
          count: periodData.totals.count,
        },
        byType: {
          PAGAR: {
            amount: Math.round(periodData.byType.PAGAR.amount * 100) / 100,
            totalAmount: Math.round(periodData.byType.PAGAR.totalAmount * 100) / 100,
            count: periodData.byType.PAGAR.count,
          },
          RECEBER: {
            amount: Math.round(periodData.byType.RECEBER.amount * 100) / 100,
            totalAmount: Math.round(periodData.byType.RECEBER.totalAmount * 100) / 100,
            count: periodData.byType.RECEBER.count,
          },
        },
        categories: Object.fromEntries(
          Object.entries(periodData.categories).map(([cat, data]) => [
            cat,
            {
              amount: Math.round(data.amount * 100) / 100,
              discount: Math.round(data.discount * 100) / 100,
              interest: Math.round(data.interest * 100) / 100,
              totalAmount: Math.round(data.totalAmount * 100) / 100,
              count: data.count,
            },
          ])
        ),
      }));

    // Calculate overall totals
    const overallTotals = entries.reduce(
      (acc, entry) => ({
        amount: acc.amount + Number(entry.amount),
        discount: acc.discount + Number(entry.discount),
        interest: acc.interest + Number(entry.interest),
        totalAmount: acc.totalAmount + Number(entry.totalAmount),
        count: acc.count + 1,
      }),
      { amount: 0, discount: 0, interest: 0, totalAmount: 0, count: 0 }
    );

    return NextResponse.json({
      success: true,
      data: {
        period,
        dateFrom: dateFrom || null,
        dateTo: dateTo || null,
        totalEntries: entries.length,
        overallTotals: {
          amount: Math.round(overallTotals.amount * 100) / 100,
          discount: Math.round(overallTotals.discount * 100) / 100,
          interest: Math.round(overallTotals.interest * 100) / 100,
          totalAmount: Math.round(overallTotals.totalAmount * 100) / 100,
          count: overallTotals.count,
        },
        report: reportData,
      },
    });
  } catch (error) {
    console.error('Error generating financial report:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao gerar relatório financeiro' },
      { status: 500 }
    );
  }
}
