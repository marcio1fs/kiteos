import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';
import { generateNextNumber } from '@/lib/numbering';

// GET /api/sales - List sales
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

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

    const where: Prisma.SaleWhereInput = {
      officeId,
      deleted: false,
    };

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { number: { contains: search } },
        { client: { name: { contains: search } } },
        { obs: { contains: search } },
      ];
    }

    const total = await db.sale.count({ where });

    const sales = await db.sale.findMany({
      where,
      include: {
        client: {
          select: { id: true, name: true, phone: true, cpfCnpj: true },
        },
        items: {
          where: { deleted: false },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return NextResponse.json({
      success: true,
      data: sales,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error listing sales:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao listar vendas' },
      { status: 500 }
    );
  }
}

// POST /api/sales - Create sale (PDV)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      officeId,
      clientId,
      discount = 0,
      paymentMethod,
      obs,
      items = [],
    } = body;

    // Validate required fields
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

    if (!items || items.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Pelo menos um item é obrigatório' },
        { status: 400 }
      );
    }

    // Validate client if provided
    if (clientId) {
      const client = await db.client.findFirst({
        where: { id: clientId, officeId, deleted: false },
      });
      if (!client) {
        return NextResponse.json(
          { success: false, error: 'Cliente não encontrado' },
          { status: 404 }
        );
      }
    }

    // Validate PECA items - check parts exist and have stock
    for (const item of items) {
      if (item.partId) {
        const part = await db.part.findFirst({
          where: { id: item.partId, officeId, deleted: false },
        });
        if (!part) {
          return NextResponse.json(
            { success: false, error: `Peça não encontrada: ${item.partId}` },
            { status: 404 }
          );
        }
        // ============================================================================
        // SECURITY FIX: Prevent negative stock — compare Decimal values properly
        // Was using part.quantity < item.quantity which fails for Decimal types
        // ============================================================================
        if (Number(part.quantity) < Number(item.quantity)) {
          return NextResponse.json(
            {
              success: false,
              error: `Estoque insuficiente para "${part.description}". Disponível: ${part.quantity}, Solicitado: ${item.quantity}`,
            },
            { status: 400 }
          );
        }
      }
    }

    // Auto-generate sale number: A001, A002, ..., A999, B001, ...
    const finalNumber = await generateNextNumber('sale');

    // Calculate totals from items
    let subtotal = 0;
    const processedItems = items.map((item: {
      description: string;
      quantity: number;
      unitPrice: number;
      partId?: string;
    }) => {
      const totalPrice = item.quantity * item.unitPrice;
      subtotal += totalPrice;
      return {
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice,
        partId: item.partId || null,
      };
    });

    // ============================================================================
    // SECURITY FIX: Validate discount is not greater than subtotal
    // Prevents negative totalAmount (financial fraud vector)
    // ============================================================================
    if (discount > subtotal) {
      return NextResponse.json(
        { success: false, error: 'Desconto não pode ser maior que o subtotal' },
        { status: 400 }
      );
    }
    const totalAmount = subtotal - discount;

    // Determine status based on payment method
    const status = paymentMethod ? 'PAGA' : 'ABERTA';

    // Create sale with items in a transaction
    const sale = await db.$transaction(async (tx) => {
      const newSale = await tx.sale.create({
        data: {
          number: finalNumber,
          status,
          discount,
          totalAmount,
          paymentMethod: paymentMethod || null,
          paidAt: paymentMethod ? new Date() : null,
          obs: obs || null,
          clientId: clientId || null,
          officeId,
          items: {
            create: processedItems,
          },
        },
        include: {
          client: true,
          items: true,
        },
      });

      // === DEDUCT STOCK FOR PART ITEMS ===
      // ============================================================================
      // SECURITY FIX: Check stock AGAIN inside transaction + use optimistic locking
      // The check outside the transaction is a TOCTOU (time-of-check-time-of-use) issue
      // Now we verify stock inside the transaction where we actually deduct
      // ============================================================================
      const partItems = items.filter((item: { partId?: string }) => item.partId);
      for (const item of partItems) {
        const part = await tx.part.findFirst({
          where: { id: item.partId, officeId, deleted: false },
        });
        if (!part) continue;

        // SECURITY FIX: Verify stock is sufficient INSIDE the transaction
        if (Number(part.quantity) < Number(item.quantity)) {
          throw new Error(`Estoque insuficiente para "${part.description}". Disponível: ${part.quantity}, Solicitado: ${item.quantity}`);
        }

        // SECURITY FIX: Use optimistic locking (version) for stock deduction
        const newQty = Number(part.quantity) - Number(item.quantity);
        const updateResult = await tx.part.updateMany({
          where: { id: part.id, version: part.version },
          data: {
            quantity: newQty,
            version: { increment: 1 },
          },
        });

        if (updateResult.count === 0) {
          throw new Error(`Conflito de concorrência ao atualizar estoque de "${part.description}". Tente novamente.`);
        }

        // Create SAIDA stock movement
        await tx.stockMovement.create({
          data: {
            type: 'SAIDA',
            quantity: item.quantity,
            unitCost: part.costPrice,
            reason: 'Venda PDV (balcão)',
            reference: finalNumber,
            partId: part.id,
            officeId,
          },
        });
      }

      // === CREATE FINANCIAL ENTRY IF PAID ===
      if (paymentMethod) {
        await tx.financialEntry.create({
          data: {
            type: 'RECEBER',
            category: 'PDV',
            description: `Venda ${finalNumber}`,
            amount: totalAmount,
            discount: 0,
            interest: 0,
            totalAmount,
            status: 'PAGO',
            dueDate: new Date(),
            paymentDate: new Date(),
            paymentMethod,
            reference: finalNumber,
            saleId: newSale.id,
            officeId,
          },
        });
      }

      return newSale;
    });

    return NextResponse.json({ success: true, data: sale }, { status: 201 });
  } catch (error) {
    console.error('Error creating sale:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao criar venda' },
      { status: 500 }
    );
  }
}
