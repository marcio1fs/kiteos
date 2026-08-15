import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';

// POST /api/parts/batch-pricing - Update sale prices & margins for a list of parts from stock entry
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, invoiceId, items } = body;

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId, 'ADMIN');
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error?.message || 'Não autorizado' },
        { status: auth.error?.status || 401 }
      );
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Lista de itens para precificação é obrigatória' },
        { status: 400 }
      );
    }

    let updatedCount = 0;

    await db.$transaction(async (tx) => {
      for (const item of items) {
        if (!item.partId) continue;
        const costPrice = Number(item.costPrice || 0);
        const salePrice = Number(item.salePrice || 0);

        if (salePrice <= 0) continue;

        const updated = await tx.part.updateMany({
          where: {
            id: item.partId,
            officeId,
            deleted: false,
          },
          data: {
            costPrice: costPrice > 0 ? costPrice : undefined,
            salePrice,
            version: { increment: 1 },
          },
        });

        updatedCount += updated.count;
      }

      // If invoiceId is provided, we can log audit or update invoice metadata
      if (invoiceId) {
        await createAuditLog({
          officeId,
          action: 'UPDATE',
          entity: 'InvoicePricing',
          entityId: invoiceId,
          details: JSON.stringify({
            invoiceId,
            updatedItems: updatedCount,
          }),
        });
      }
    });

    return NextResponse.json({
      success: true,
      data: {
        message: `${updatedCount} produto(s) tiveram seus preços de venda atualizados com sucesso.`,
        updatedCount,
      },
    });
  } catch (error) {
    logger.error('Error batch updating part prices:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar preços de venda' },
      { status: 500 }
    );
  }
}
