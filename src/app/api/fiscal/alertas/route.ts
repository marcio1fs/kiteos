import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { generateFiscalAlerts } from '@/lib/fiscal/dashboard-service';

// GET /api/fiscal/alertas - List active alerts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const tipo = searchParams.get('tipo');
    const severidade = searchParams.get('severidade');
    const lido = searchParams.get('lido');
    const refresh = searchParams.get('refresh') === 'true';

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

    // Optionally refresh alerts
    if (refresh) {
      try {
        await generateFiscalAlerts(officeId);
      } catch (e) {
        console.error('Error refreshing fiscal alerts:', e);
      }
    }

    const where: Record<string, unknown> = {
      officeId,
      resolvido: false,
    };

    if (tipo) where.tipo = tipo;
    if (severidade) where.severidade = severidade;
    if (lido !== null && lido !== undefined) where.lido = lido === 'true';

    const alertas = await db.fiscalAlerta.findMany({
      where,
      orderBy: [
        { severidade: 'desc' },
        { dataVencimento: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    // Count unread
    const naoLidos = await db.fiscalAlerta.count({
      where: { officeId, lido: false, resolvido: false },
    });

    // Count by severity
    const criticos = await db.fiscalAlerta.count({
      where: { officeId, severidade: 'CRITICO', resolvido: false },
    });

    return NextResponse.json({
      success: true,
      data: {
        alertas,
        total: alertas.length,
        naoLidos,
        criticos,
      },
    });
  } catch (error) {
    console.error('Error listing fiscal alerts:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao listar alertas fiscais' },
      { status: 500 }
    );
  }
}
