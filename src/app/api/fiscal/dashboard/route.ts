import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { requireAuth } from '@/lib/auth';
import { getFiscalDashboard, generateFiscalAlerts } from '@/lib/fiscal/dashboard-service';

// GET /api/fiscal/dashboard - Returns complete fiscal dashboard data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const refreshAlerts = searchParams.get('refreshAlerts') === 'true';

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

    // Optionally refresh alerts before fetching dashboard
    if (refreshAlerts) {
      try {
        await generateFiscalAlerts(officeId);
      } catch (e) {
        logger.error('Error refreshing fiscal alerts:', { error: e instanceof Error ? e.message : String(e) });
        // Don't fail the whole request if alerts generation fails
      }
    }

    const dashboardData = await getFiscalDashboard(officeId);

    return NextResponse.json({ success: true, data: dashboardData });
  } catch (error) {
    logger.error('Error getting fiscal dashboard:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar dados do dashboard fiscal' },
      { status: 500 }
    );
  }
}
