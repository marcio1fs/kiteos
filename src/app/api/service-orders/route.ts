import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';
import { osItemSchema } from '@/lib/service-orders';
import { formatDocumentNumber } from '@/lib/sales';
import { CommercialError, commercialErrorResponse, adjustStock, idSchema, moneySchema, paymentMethodSchema, toCents, fromCents } from '@/lib/commercial';
import { assertCanCreate, isPlanError, planErrorBody } from '@/lib/plans';
import { z } from 'zod';

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
        { number: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { client: { name: { contains: search, mode: 'insensitive' } } },
        { vehicle: { plate: { contains: search, mode: 'insensitive' } } },
        { vehicle: { model: { contains: search, mode: 'insensitive' } } },
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
    logger.error('Error listing service orders:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao listar ordens de serviço' },
      { status: 500 }
    );
  }
}

const createOsSchema = z.object({
  officeId: idSchema,
  clientId: idSchema,
  vehicleId: idSchema,
  description: z.string().max(2000).nullish(),
  diagnosis: z.string().max(5000).nullish(),
  totalDiscount: moneySchema.default(0),
  paymentMethod: paymentMethodSchema.nullish(),
  items: z.array(osItemSchema).min(1).max(200),
}).strict();

// POST /api/service-orders - Create service order with atomic stock reservation
export async function POST(request: NextRequest) {
  try {
    const input = createOsSchema.parse(await request.json());
    const auth = await requireAuth(request, input.officeId);
    if (!auth.payload) return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });

    const serviceOrder = await db.$transaction(async (tx) => {
      // Plan limits are enforced here, inside the write transaction, so the count
      // cannot go stale between the check and the INSERT.
      await assertCanCreate(tx, input.officeId, 'OS');

      const client = await tx.client.findFirst({ where: { id: input.clientId, officeId: input.officeId, deleted: false } });
      if (!client) throw new CommercialError('Cliente não encontrado nesta oficina', 404);
      const vehicle = await tx.vehicle.findFirst({ where: { id: input.vehicleId, officeId: input.officeId, clientId: input.clientId, deleted: false } });
      if (!vehicle) throw new CommercialError('Veículo não encontrado para este cliente', 404);

      let totalPartsCents = 0;
      let totalServicesCents = 0;
      for (const item of input.items) {
        const total = Math.round(toCents(item.unitPrice) * item.quantity);
        if (item.type === 'PECA') {
          totalPartsCents += total;
          const part = await tx.part.findFirst({ where: { id: item.partId!, officeId: input.officeId, deleted: false } });
          if (!part) throw new CommercialError(`Peça não encontrada nesta oficina: ${item.partId}`, 404);
        } else {
          totalServicesCents += total;
          if (item.mechanicId) {
            const mechanic = await tx.mechanic.findFirst({ where: { id: item.mechanicId, officeId: input.officeId, active: true, deleted: false } });
            if (!mechanic) throw new CommercialError(`Mecânico não encontrado nesta oficina: ${item.mechanicId}`, 404);
          }
        }
      }
      const discountCents = toCents(input.totalDiscount);
      if (discountCents > totalPartsCents + totalServicesCents) throw new CommercialError('Desconto não pode ser maior que o total da OS', 400);

      const existing = await tx.serviceOrder.findMany({ where: { officeId: input.officeId }, select: { number: true } });
      let max = 0;
      for (const { number } of existing) {
        const m = /^([A-Z])(\d{3})$/.exec(number);
        if (m) max = Math.max(max, (m[1].charCodeAt(0) - 65) * 999 + Number(m[2]));
      }
      const seq = await tx.sequencer.upsert({
        where: { officeId_entity: { officeId: input.officeId, entity: 'SERVICE_ORDER' } },
        create: { officeId: input.officeId, entity: 'SERVICE_ORDER', currentValue: max + 1 },
        update: { currentValue: { increment: 1 } },
      });
      let sequence = seq.currentValue;
      if (sequence <= max) {
        const bumped = await tx.sequencer.update({ where: { officeId_entity: { officeId: input.officeId, entity: 'SERVICE_ORDER' } }, data: { currentValue: max + 1 } });
        sequence = bumped.currentValue;
      }
      const number = formatDocumentNumber(sequence);

      const os = await tx.serviceOrder.create({
        data: {
          number, status: 'ABERTA', description: input.description, diagnosis: input.diagnosis,
          totalParts: fromCents(totalPartsCents), totalServices: fromCents(totalServicesCents),
          totalDiscount: fromCents(discountCents), totalAmount: fromCents(totalPartsCents + totalServicesCents - discountCents),
          paymentMethod: input.paymentMethod, clientId: input.clientId, vehicleId: input.vehicleId, officeId: input.officeId,
          items: {
            create: input.items.map(item => {
              const total = Math.round(toCents(item.unitPrice) * item.quantity);
              const commPct = item.type === 'SERVICO' && item.mechanicId ? (item.commissionPct ?? 0) : 0;
              return {
                type: item.type, description: item.description, quantity: item.quantity, unitPrice: item.unitPrice,
                totalPrice: fromCents(total), partId: item.type === 'PECA' ? item.partId : null,
                mechanicId: item.type === 'SERVICO' ? (item.mechanicId || null) : null,
                commissionPct: commPct, commissionValue: fromCents(Math.round(total * commPct / 100)), officeId: input.officeId,
              };
            }),
          },
        },
        include: { client: true, vehicle: true, items: true },
      });

      for (const item of input.items) {
        if (item.type === 'PECA' && item.partId) {
          await adjustStock(tx, { officeId: input.officeId, partId: item.partId, delta: -item.quantity, reason: 'Baixa via Ordem de Serviço', reference: `OS:${os.id}` });
        }
      }

      if (client.phone || client.email) {
        await tx.notification.create({
          data: {
            type: client.phone ? 'WHATSAPP' : 'EMAIL', template: 'OS_CREATED', title: 'Ordem de Serviço Criada',
            message: `Sua Ordem de Serviço ${number} foi criada com sucesso. Valor total: R$ ${fromCents(totalPartsCents + totalServicesCents - discountCents).toFixed(2)}`,
            recipient: client.phone || client.email, status: 'PENDENTE', serviceOrderId: os.id, officeId: input.officeId,
          },
        });
      }
      await tx.auditLog.create({
        data: { action: 'CREATE', entity: 'ServiceOrder', entityId: os.id, details: JSON.stringify({ number }), userId: auth.payload.userId, officeId: input.officeId },
      });
      return os;
    });

    return NextResponse.json({ success: true, data: serviceOrder }, { status: 201 });
  } catch (error) {
    if (isPlanError(error)) return NextResponse.json(planErrorBody(error).body, { status: error.status });
    const known = commercialErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error creating service order:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao criar ordem de serviço' }, { status: 500 });
  }
}
