import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';
import { adjustStock, commercialErrorResponse, idSchema, moneySchema, quantitySchema } from '@/lib/commercial';
import { z } from 'zod';

// GET /api/stock-movements - List stock movements
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const partId = searchParams.get('partId');
    const type = searchParams.get('type');
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

    const where: Prisma.StockMovementWhereInput = {
      officeId,
      deleted: false,
    };

    if (partId) {
      where.partId = partId;
    }

    if (type) {
      where.type = type;
    }

    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        where.createdAt.gte = new Date(dateFrom);
      }
      if (dateTo) {
        const toDate = new Date(dateTo);
        toDate.setDate(toDate.getDate() + 1); // Include the entire day
        where.createdAt.lt = toDate;
      }
    }

    const stockMovements = await db.stockMovement.findMany({
      where,
      include: {
        part: {
          select: {
            id: true,
            sku: true,
            description: true,
            unit: true,
            quantity: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: stockMovements });
  } catch (error) {
    logger.error('Error listing stock movements:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao listar movimentações de estoque' },
      { status: 500 }
    );
  }
}

const movementSchema = z.object({
  officeId: idSchema,
  partId: idSchema,
  type: z.enum(['ENTRADA', 'SAIDA']),
  quantity: quantitySchema,
  unitCost: moneySchema.optional(),
  reason: z.string().max(500).nullish(),
  reference: z.string().max(200).nullish(),
}).strict();

// POST /api/stock-movements - Atomic, tenant-scoped stock movement
export async function POST(request: NextRequest) {
  try {
    const input = movementSchema.parse(await request.json());
    const auth = await requireAuth(request, input.officeId);
    if (!auth.payload) return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });

    const result = await db.$transaction(async (tx) => {
      const { movement, previousQuantity, newQuantity, part } = await adjustStock(tx, {
        officeId: input.officeId,
        partId: input.partId,
        delta: input.type === 'ENTRADA' ? input.quantity : -input.quantity,
        reason: input.reason || 'Movimentação manual',
        reference: input.reference || 'MANUAL',
        unitCost: input.unitCost,
      });
      await tx.auditLog.create({
        data: {
          action: 'STOCK_MOVEMENT', entity: 'StockMovement', entityId: movement.id,
          details: JSON.stringify({ partSku: part.sku, type: input.type, quantity: input.quantity, previousQuantity, newQuantity }),
          userId: auth.payload.userId, officeId: input.officeId,
        },
      });
      return tx.stockMovement.findFirst({
        where: { id: movement.id, officeId: input.officeId },
        include: { part: { select: { id: true, sku: true, description: true, unit: true, quantity: true } } },
      });
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    const known = commercialErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error creating stock movement:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao criar movimentação de estoque' }, { status: 500 });
  }
}
