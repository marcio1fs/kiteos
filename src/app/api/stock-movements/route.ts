import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';

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
    console.error('Error listing stock movements:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao listar movimentações de estoque' },
      { status: 500 }
    );
  }
}

// POST /api/stock-movements - Create stock movement
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      officeId,
      partId,
      type,
      quantity,
      unitCost,
      reason,
      reference,
    } = body;

    // Validate required fields
    if (!officeId || !partId || !type || quantity === undefined) {
      return NextResponse.json(
        { success: false, error: 'officeId, partId, type e quantity são obrigatórios' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    if (!['ENTRADA', 'SAIDA'].includes(type)) {
      return NextResponse.json(
        { success: false, error: 'type deve ser ENTRADA ou SAIDA' },
        { status: 400 }
      );
    }

    if (quantity <= 0) {
      return NextResponse.json(
        { success: false, error: 'quantity deve ser maior que zero' },
        { status: 400 }
      );
    }

    // Check if part exists
    const part = await db.part.findFirst({
      where: { id: partId, officeId, deleted: false },
    });

    if (!part) {
      return NextResponse.json(
        { success: false, error: 'Peça não encontrada' },
        { status: 404 }
      );
    }

    // Validate no negative stock for SAIDA
    if (type === 'SAIDA') {
      const currentQuantity = parseFloat(String(part.quantity));
      if (currentQuantity < quantity) {
        return NextResponse.json(
          {
            success: false,
            error: `Estoque insuficiente para "${part.description}". Disponível: ${currentQuantity}, Solicitado: ${quantity}`,
          },
          { status: 400 }
        );
      }
    }

    // Create stock movement and update part quantity in transaction
    const result = await db.$transaction(async (tx) => {
      const movement = await tx.stockMovement.create({
        data: {
          type,
          quantity,
          unitCost: unitCost || 0,
          reason: reason || null,
          reference: reference || null,
          partId,
          officeId,
        },
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
      });

      // Update part quantity
      const currentQty = parseFloat(String(part.quantity));
      let newQuantity: number;

      if (type === 'ENTRADA') {
        newQuantity = currentQty + quantity;
      } else {
        newQuantity = currentQty - quantity;
      }

      await tx.part.update({
        where: { id: partId },
        data: { quantity: newQuantity },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          action: 'STOCK_MOVEMENT',
          entity: 'StockMovement',
          entityId: movement.id,
          details: JSON.stringify({
            partSku: part.sku,
            partDescription: part.description,
            type,
            quantity,
            previousQuantity: currentQty,
            newQuantity,
            reason: reason || null,
            reference: reference || null,
          }),
          officeId,
        },
      });

      return movement;
    });

    return NextResponse.json({ success: true, data: result }, { status: 201 });
  } catch (error) {
    console.error('Error creating stock movement:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao criar movimentação de estoque' },
      { status: 500 }
    );
  }
}
