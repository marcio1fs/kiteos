import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';
import { generateNextNumber } from '@/lib/numbering';

// GET /api/service-orders - List service orders
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const status = searchParams.get('status');
    const search = searchParams.get('search');

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

    const where: Prisma.ServiceOrderWhereInput = {
      officeId,
      deleted: false,
    };

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { number: { contains: search } },
        { description: { contains: search } },
        { client: { name: { contains: search } } },
        { vehicle: { plate: { contains: search } } },
        { vehicle: { model: { contains: search } } },
      ];
    }

    const serviceOrders = await db.serviceOrder.findMany({
      where,
      include: {
        client: {
          select: { id: true, name: true, phone: true, email: true },
        },
        vehicle: {
          select: { id: true, plate: true, brand: true, model: true, year: true, color: true },
        },
        items: {
          where: { deleted: false },
          include: {
            mechanic: {
              select: { id: true, name: true, commissionPct: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ success: true, data: serviceOrders });
  } catch (error) {
    console.error('Error listing service orders:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao listar ordens de serviço' },
      { status: 500 }
    );
  }
}

// POST /api/service-orders - Create service order
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      officeId,
      clientId,
      vehicleId,
      description,
      diagnosis,
      totalDiscount = 0,
      paymentMethod,
      items = [],
    } = body;

    // Validate required fields
    if (!officeId || !clientId || !vehicleId) {
      return NextResponse.json(
        { success: false, error: 'officeId, clientId e vehicleId são obrigatórios' },
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

    // Validate client and vehicle belong to office
    const client = await db.client.findFirst({
      where: { id: clientId, officeId, deleted: false },
    });
    if (!client) {
      return NextResponse.json(
        { success: false, error: 'Cliente não encontrado' },
        { status: 404 }
      );
    }

    const vehicle = await db.vehicle.findFirst({
      where: { id: vehicleId, officeId, deleted: false },
    });
    if (!vehicle) {
      return NextResponse.json(
        { success: false, error: 'Veículo não encontrado' },
        { status: 404 }
      );
    }

    // Validate PECA items - check parts exist and have stock
    for (const item of items) {
      if (item.type === 'PECA') {
        if (!item.partId) {
          return NextResponse.json(
            { success: false, error: `Item "${item.description}" do tipo PECA requer partId` },
            { status: 400 }
          );
        }
        const part = await db.part.findFirst({
          where: { id: item.partId, officeId, deleted: false },
        });
        if (!part) {
          return NextResponse.json(
            { success: false, error: `Peça não encontrada: ${item.partId}` },
            { status: 404 }
          );
        }
        if (part.quantity < item.quantity) {
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

    // Auto-generate OS number: A001, A002, ..., A999, B001, ...
    const finalNumber = await generateNextNumber('serviceOrder');

    // Calculate totals from items
    let totalParts = 0;
    let totalServices = 0;

    const processedItems = items.map((item: {
      type: string;
      description: string;
      quantity: number;
      unitPrice: number;
      partId?: string;
      mechanicId?: string;
      commissionPct?: number;
    }) => {
      const totalPrice = item.quantity * item.unitPrice;
      if (item.type === 'PECA') {
        totalParts += totalPrice;
      } else {
        totalServices += totalPrice;
      }
      // Calculate commission for service items with mechanic
      const commPct = item.type === 'SERVICO' && item.mechanicId ? (item.commissionPct ?? 0) : 0;
      const commValue = totalPrice * (commPct / 100);
      return {
        type: item.type,
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice,
        partId: item.partId || null,
        mechanicId: item.mechanicId || null,
        commissionPct: commPct,
        commissionValue: commValue,
      };
    });

    const totalAmount = totalParts + totalServices - totalDiscount;

    // Create service order with items in a transaction (with stock deduction for PECA items)
    const serviceOrder = await db.$transaction(async (tx) => {
      const os = await tx.serviceOrder.create({
        data: {
          number: finalNumber,
          status: 'ABERTA',
          description,
          diagnosis,
          totalParts,
          totalServices,
          totalDiscount,
          totalAmount,
          paymentMethod,
          clientId,
          vehicleId,
          officeId,
          items: {
            create: processedItems,
          },
        },
        include: {
          client: true,
          vehicle: true,
          items: true,
        },
      });

      // === DEDUCT STOCK FOR PECA ITEMS (baixa no estoque) ===
      // SECURITY FIX (AUD-03): Added optimistic locking for stock deduction
      // Previously used simple update — race condition could allow negative stock
      const pecaItems = items.filter((item: { type: string; partId?: string }) => item.type === 'PECA' && item.partId);
      for (const item of pecaItems) {
        const part = await tx.part.findFirst({
          where: { id: item.partId, officeId, deleted: false },
        });
        if (!part) continue;

        // SECURITY FIX (AUD-03): Verify stock is sufficient INSIDE the transaction
        if (Number(part.quantity) < Number(item.quantity)) {
          throw new Error(`Estoque insuficiente para "${part.description}". Disponível: ${part.quantity}, Solicitado: ${item.quantity}`);
        }

        // Create SAIDA stock movement
        await tx.stockMovement.create({
          data: {
            type: 'SAIDA',
            quantity: item.quantity,
            unitCost: part.costPrice,
            reason: 'Baixa via Ordem de Serviço',
            reference: finalNumber,
            partId: part.id,
            officeId,
          },
        });

        // SECURITY FIX (AUD-03): Use optimistic locking (version) for stock deduction
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
      }

      // Create notification for client
      if (client.phone || client.email) {
        await tx.notification.create({
          data: {
            type: client.phone ? 'WHATSAPP' : 'EMAIL',
            template: 'OS_CREATED',
            title: 'Ordem de Serviço Criada',
            message: `Sua Ordem de Serviço ${finalNumber} foi criada com sucesso. Valor total: R$ ${totalAmount.toFixed(2)}`,
            recipient: client.phone || client.email,
            status: 'PENDENTE',
            serviceOrderId: os.id,
            officeId,
          },
        });
      }

      return os;
    });

    return NextResponse.json({ success: true, data: serviceOrder }, { status: 201 });
  } catch (error) {
    console.error('Error creating service order:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao criar ordem de serviço' },
      { status: 500 }
    );
  }
}
