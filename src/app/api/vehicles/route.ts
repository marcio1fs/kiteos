import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/auth';
import { Prisma } from '@prisma/client';

// SEC-08 FIX: Migrated from verifyToken+getTokenFromHeaders to requireAuth
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const clientId = searchParams.get('clientId');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    if (!officeId) {
      return NextResponse.json({ success: false, error: 'officeId é obrigatório' }, { status: 400 });
    }

    // Validate office belongs to user
    if (auth.payload.officeId !== officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado a este escritório' }, { status: 403 });
    }

    const where: Prisma.VehicleWhereInput = {
      officeId,
      deleted: false,
    };

    if (clientId) {
      where.clientId = clientId;
    }

    if (search) {
      where.OR = [
        { plate: { contains: search.toUpperCase() } },
        { brand: { contains: search } },
        { model: { contains: search } },
        { chassi: { contains: search } },
      ];
    }

    const [vehicles, total] = await Promise.all([
      db.vehicle.findMany({
        where,
        include: {
          client: {
            select: { id: true, name: true, phone: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.vehicle.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: vehicles,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('List vehicles error:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const body = await request.json();
    const { plate, brand, model, year, color, km, chassi, clientId, officeId } = body;

    if (!plate || !clientId || !officeId) {
      return NextResponse.json(
        { success: false, error: 'Placa, clientId e officeId são obrigatórios' },
        { status: 400 }
      );
    }

    // Validate office belongs to user
    if (auth.payload.officeId !== officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado a este escritório' }, { status: 403 });
    }

    // Validate client exists and belongs to office
    const client = await db.client.findFirst({
      where: { id: clientId, officeId, deleted: false },
    });

    if (!client) {
      return NextResponse.json(
        { success: false, error: 'Cliente não encontrado neste escritório' },
        { status: 404 }
      );
    }

    // Check plate uniqueness within office
    const existingPlate = await db.vehicle.findFirst({
      where: { plate: plate.toUpperCase(), officeId, deleted: false },
    });

    if (existingPlate) {
      return NextResponse.json(
        { success: false, error: 'Placa já cadastrada neste escritório' },
        { status: 409 }
      );
    }

    const vehicle = await db.vehicle.create({
      data: {
        plate: plate.toUpperCase(),
        brand: brand || null,
        model: model || null,
        year: year || null,
        color: color || null,
        km: km || null,
        chassi: chassi || null,
        clientId,
        officeId,
      },
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
    });

    await auditLog({
      action: 'CREATE',
      entity: 'Vehicle',
      entityId: vehicle.id,
      details: JSON.stringify({ plate: vehicle.plate, brand: vehicle.brand, model: vehicle.model }),
      userId: auth.payload.userId,
      officeId,
    });

    return NextResponse.json({ success: true, data: vehicle }, { status: 201 });
  } catch (error) {
    logger.error('Create vehicle error:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}
