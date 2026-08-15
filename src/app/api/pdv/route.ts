import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// GET /api/pdv - List sales (history)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const status = searchParams.get('status');

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

    const where: Record<string, unknown> = {
      officeId,
      deleted: false,
    };

    if (status) {
      where.status = status;
    }

    const sales = await db.sale.findMany({
      where,
      include: {
        items: { where: { deleted: false } },
        client: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: sales });
  } catch (error) {
    logger.error('Error listing sales:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao listar vendas' },
      { status: 500 }
    );
  }
}

// POST /api/pdv - Create a new sale (finalize PDV)
// PDV-01 FIX: Wrapped sale creation AND stock deduction in a single $transaction
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, items, discount, paymentMethod, clientId, pendingPayment } = body;

    if (!officeId || !items || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'officeId e itens são obrigatórios' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    // Generate sale number
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const count = await db.sale.count({
      where: {
        officeId,
        createdAt: {
          gte: new Date(today.getFullYear(), today.getMonth(), today.getDate()),
        },
      },
    });
    const number = `PDV${dateStr}${String(count + 1).padStart(4, '0')}`;

    // Calculate totals
    let subtotal = 0;
    const saleItemsData: { description: string; quantity: number; unitPrice: number; totalPrice: number; partId: string | null; officeId: string }[] = [];

    for (const item of items) {
      const unitPrice = Number(item.unitPrice) || 0;
      const quantity = Number(item.quantity) || 1;
      const totalPrice = unitPrice * quantity;
      subtotal += totalPrice;

      saleItemsData.push({
        description: item.description,
        quantity,
        unitPrice,
        totalPrice,
        partId: item.partId || null,
        officeId,
      });
    }

    const discountValue = Number(discount) || 0;
    const totalAmount = Math.max(0, subtotal - discountValue);

    // Validate stock for PECA items (pre-check outside transaction for clearer error messages)
    for (const item of saleItemsData) {
      if (item.partId) {
        const part = await db.part.findFirst({
          where: { id: item.partId, officeId, deleted: false },
        });
        if (!part) {
          return NextResponse.json(
            { success: false, error: `Produto não encontrado: ${item.description}` },
            { status: 404 }
          );
        }
        const currentStock = parseFloat(String(part.quantity));
        if (currentStock < item.quantity) {
          return NextResponse.json(
            { success: false, error: `Estoque insuficiente para "${item.description}". Disponível: ${currentStock}` },
            { status: 400 }
          );
        }
      }
    }

    // PDV-01 FIX: Wrap everything in a single $transaction
    const sale = await db.$transaction(async (tx) => {
      // Create sale with items
      const createdSale = await tx.sale.create({
        data: {
          number,
          status: pendingPayment ? 'ABERTA' : 'PAGA',
          discount: discountValue,
          totalAmount,
          paymentMethod: paymentMethod || null,
          paidAt: pendingPayment ? null : new Date(),
          clientId: clientId || null,
          officeId,
          items: {
            create: saleItemsData,
          },
        },
        include: {
          items: true,
          client: { select: { id: true, name: true } },
        },
      });

      // Deduct stock and create stock movements (only for non-pending payments)
      if (!pendingPayment) {
        for (const item of saleItemsData) {
          if (item.partId) {
            const part = await tx.part.findFirst({
              where: { id: item.partId, officeId, deleted: false },
            });
            if (part) {
              const currentQty = parseFloat(String(part.quantity));
              const newQty = Math.max(0, currentQty - Number(item.quantity));

              await tx.part.update({
                where: { id: item.partId },
                data: { quantity: newQty },
              });

              await tx.stockMovement.create({
                data: {
                  type: 'SAIDA',
                  quantity: Number(item.quantity),
                  unitCost: Number(part.costPrice),
                  reason: 'Venda PDV',
                  reference: number,
                  partId: item.partId,
                  officeId,
                },
              });
            }
          }
        }

        // Create financial entry
        await tx.financialEntry.create({
          data: {
            type: 'RECEBER',
            category: 'PDV',
            description: `Venda PDV ${number}`,
            amount: totalAmount,
            discount: discountValue,
            interest: 0,
            totalAmount,
            status: 'PAGO',
            dueDate: new Date(),
            paymentDate: new Date(),
            paymentMethod: paymentMethod || 'DINHEIRO',
            reference: number,
            officeId,
          },
        });
      }

      // Audit log
      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entity: 'Sale',
          entityId: createdSale.id,
          details: JSON.stringify({ number, totalAmount, items: saleItemsData.length }),
          officeId,
        },
      });

      return createdSale;
    });

    return NextResponse.json({ success: true, data: sale }, { status: 201 });
  } catch (error) {
    logger.error('Error creating sale:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao criar venda' },
      { status: 500 }
    );
  }
}
