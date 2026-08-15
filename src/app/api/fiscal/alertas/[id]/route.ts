import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/auth';

// PUT /api/fiscal/alertas/[id] - Update alert (mark as read/resolved)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { officeId, acao } = body;

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

    const alerta = await db.fiscalAlerta.findUnique({
      where: { id },
    });

    if (!alerta || alerta.officeId !== officeId) {
      return NextResponse.json(
        { success: false, error: 'Alerta não encontrado' },
        { status: 404 }
      );
    }

    let updated;

    if (acao === 'ler') {
      // Mark as read
      updated = await db.fiscalAlerta.update({
        where: { id },
        data: { lido: true },
      });
    } else if (acao === 'resolver') {
      // Mark as resolved
      updated = await db.fiscalAlerta.update({
        where: { id },
        data: { resolvido: true, lido: true },
      });
    } else if (acao === 'ler_todos') {
      // Mark all alerts as read for this office
      await db.fiscalAlerta.updateMany({
        where: { officeId, lido: false, resolvido: false },
        data: { lido: true },
      });
      return NextResponse.json({ success: true, data: { message: 'Todos os alertas marcados como lidos' } });
    } else {
      return NextResponse.json(
        { success: false, error: 'Ação inválida. Use: ler, resolver ou ler_todos' },
        { status: 400 }
      );
    }

    // Audit log
    await auditLog({
      action: 'UPDATE',
      entity: 'FiscalAlerta',
      entityId: id,
      details: JSON.stringify({ acao, tipo: alerta.tipo }),
      userId: auth.payload.userId,
      officeId,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Error updating fiscal alert:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar alerta fiscal' },
      { status: 500 }
    );
  }
}
