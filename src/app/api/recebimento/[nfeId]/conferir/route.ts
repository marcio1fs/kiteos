import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';

// AUD-C05 FIX: Added requireAuth — was completely unauthenticated
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ nfeId: string }> }
) {
  try {
    const auth = await requireAuth(request, undefined, 'ADMIN');
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }

    const { nfeId } = await params;
    const body = await request.json();
    const { conferencias, tolerancia } = body;
    const officeId = auth.payload.officeId;
    const userId = auth.payload.userId;

    if (!conferencias || !Array.isArray(conferencias) || conferencias.length === 0) {
      return NextResponse.json(
        { success: false, errors: ['conferencias é obrigatório e deve ser um array não vazio'] },
        { status: 400 }
      );
    }

    // Fetch invoice with items and reception
    const invoice = await db.invoice.findFirst({
      where: { id: nfeId, officeId, deleted: false },
      include: {
        items: { where: { deleted: false } },
        reception: true,
      },
    });

    if (!invoice) {
      return NextResponse.json(
        { success: false, errors: ['NF-e não encontrada'] },
        { status: 404 }
      );
    }

    if (!invoice.reception) {
      return NextResponse.json(
        { success: false, errors: ['Recepção não encontrada para esta NF-e'] },
        { status: 404 }
      );
    }

    // Check reception status - can only confer if PENDENTE or DIVERGENTE
    if (invoice.reception.status === 'CONFERIDA') {
      return NextResponse.json(
        { success: false, errors: ['Recepção já foi conferida'] },
        { status: 400 }
      );
    }

    if (invoice.reception.status === 'BLOQUEADA') {
      return NextResponse.json(
        { success: false, errors: ['Recepção está bloqueada. Desbloqueie antes de conferir'] },
        { status: 400 }
      );
    }

    const defaultTolerance = tolerancia ?? 5; // 5% default
    const tolerancePercent = defaultTolerance / 100;

    const results: Array<{
      itemId: string;
      descricao: string;
      quantidadeNf: number;
      quantidadeRecebida: number;
      divergencia: number;
      divergenciaPercent: number;
      status: 'OK' | 'DIVERGENTE' | 'CRITICA';
    }> = [];

    let hasDivergence = false;
    let hasCriticalDivergence = false;
    let totalReceived = 0;

    // Process each conference item
    for (const conf of conferencias) {
      const item = invoice.items.find(i => i.id === conf.itemId);
      if (!item) {
        return NextResponse.json(
          { success: false, errors: [`Item ${conf.itemId} não encontrado na NF-e`] },
          { status: 400 }
        );
      }

      const quantidadeRecebida = conf.quantidadeRecebida;
      const diferenca = quantidadeRecebida - Number(item.quantidade);
      const itemQtd = Number(item.quantidade);
      const divergenciaPercent = itemQtd > 0 ? Math.abs(diferenca / itemQtd) : 0;

      let status: 'OK' | 'DIVERGENTE' | 'CRITICA' = 'OK';
      if (divergenciaPercent > 0) {
        if (divergenciaPercent > 0.5) {
          // > 50% divergence = critical
          status = 'CRITICA';
          hasCriticalDivergence = true;
        } else if (divergenciaPercent > tolerancePercent) {
          status = 'DIVERGENTE';
          hasDivergence = true;
        }
      }

      totalReceived += quantidadeRecebida;

      results.push({
        itemId: item.id,
        descricao: item.descricao,
        quantidadeNf: Number(item.quantidade),
        quantidadeRecebida,
        divergencia: diferenca,
        divergenciaPercent: Math.round(divergenciaPercent * 10000) / 100, // percentage with 2 decimals
        status,
      });

      // Update item divergence flag
      await db.invoiceItem.update({
        where: { id: item.id },
        data: { divergencia: status !== 'OK' },
      });
    }

    // Determine reception status
    let newReceptionStatus: string;
    let divergenciaDescricao: string | null = null;

    if (hasCriticalDivergence) {
      newReceptionStatus = 'BLOQUEADA';
      divergenciaDescricao = `Divergência crítica detectada. Itens com divergência > 50%: ${results.filter(r => r.status === 'CRITICA').map(r => r.descricao).join(', ')}`;
    } else if (hasDivergence) {
      newReceptionStatus = 'DIVERGENTE';
      divergenciaDescricao = `Divergência acima da tolerância (${defaultTolerance}%). Itens divergentes: ${results.filter(r => r.status === 'DIVERGENTE').map(r => `${r.descricao} (${r.divergenciaPercent}%)`).join(', ')}`;
    } else {
      newReceptionStatus = 'CONFERIDA';
    }

    // Update reception
    await db.reception.update({
      where: { id: invoice.reception.id },
      data: {
        status: newReceptionStatus,
        divergencia: divergenciaDescricao,
        quantidadeRecebida: totalReceived,
        conferidoPor: userId,
        updatedAt: new Date(),
      },
    });

    // Update invoice status if CONFERIDA
    if (newReceptionStatus === 'CONFERIDA') {
      await db.invoice.update({
        where: { id: nfeId },
        data: { status: 'CONFERIDA' },
      });
    } else if (newReceptionStatus === 'DIVERGENTE') {
      await db.invoice.update({
        where: { id: nfeId },
        data: { status: 'DIVERGENTE' },
      });
    }

    // Create audit log
    await createAuditLog({
      action: 'CONFERENCE',
      entity: 'Reception',
      entityId: invoice.reception.id,
      details: JSON.stringify({
        invoiceId: nfeId,
        numero: invoice.numero,
        status: newReceptionStatus,
        tolerancia: defaultTolerance,
        results,
        totalReceived,
      }),
      userId,
      officeId,
      invoiceId: nfeId,
    });

    return NextResponse.json({
      success: true,
      data: {
        invoiceId: nfeId,
        receptionStatus: newReceptionStatus,
        divergencia: divergenciaDescricao,
        results,
        summary: {
          totalItems: invoice.items.length,
          itemsOk: results.filter(r => r.status === 'OK').length,
          itemsDivergente: results.filter(r => r.status === 'DIVERGENTE').length,
          itemsCritica: results.filter(r => r.status === 'CRITICA').length,
          totalReceived,
        },
      },
    });

  } catch (error) {
    logger.error('Error confering reception:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao conferir recebimento'] },
      { status: 500 }
    );
  }
}
