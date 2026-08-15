import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/auth';

// SEC-08 FIX: Migrated from verifyToken+getTokenFromHeaders to requireAuth
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { id } = await params;

    const vehicle = await db.vehicle.findUnique({
      where: { id },
      include: {
        client: {
          select: { id: true, name: true, phone: true, email: true, cpfCnpj: true },
        },
        serviceOrders: {
          where: { deleted: false },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!vehicle || vehicle.deleted) {
      return NextResponse.json({ success: false, error: 'Veículo não encontrado' }, { status: 404 });
    }

    // Validate office belongs to user
    if (auth.payload.officeId !== vehicle.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    return NextResponse.json({ success: true, data: vehicle });
  } catch (error) {
    logger.error('Get vehicle error:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { id } = await params;
    const body = await request.json();

    const existing = await db.vehicle.findUnique({ where: { id } });

    if (!existing || existing.deleted) {
      return NextResponse.json({ success: false, error: 'Veículo não encontrado' }, { status: 404 });
    }

    if (auth.payload.officeId !== existing.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Check plate uniqueness if changing
    if (body.plate && body.plate.toUpperCase() !== existing.plate) {
      const duplicate = await db.vehicle.findFirst({
        where: {
          plate: body.plate.toUpperCase(),
          officeId: existing.officeId,
          deleted: false,
          id: { not: id },
        },
      });
      if (duplicate) {
        return NextResponse.json(
          { success: false, error: 'Placa já cadastrada neste escritório' },
          { status: 409 }
        );
      }
    }

    // If clientId is changing, validate it
    if (body.clientId && body.clientId !== existing.clientId) {
      const newClient = await db.client.findFirst({
        where: { id: body.clientId, officeId: existing.officeId, deleted: false },
      });
      if (!newClient) {
        return NextResponse.json(
          { success: false, error: 'Cliente não encontrado neste escritório' },
          { status: 404 }
        );
      }
    }

    const vehicle = await db.vehicle.update({
      where: { id },
      data: {
        ...(body.plate !== undefined && { plate: body.plate.toUpperCase() }),
        ...(body.brand !== undefined && { brand: body.brand || null }),
        ...(body.model !== undefined && { model: body.model || null }),
        ...(body.year !== undefined && { year: body.year || null }),
        ...(body.color !== undefined && { color: body.color || null }),
        ...(body.km !== undefined && { km: body.km || null }),
        ...(body.chassi !== undefined && { chassi: body.chassi || null }),
        ...(body.clientId !== undefined && { clientId: body.clientId }),
      },
      include: {
        client: {
          select: { id: true, name: true },
        },
      },
    });

    await auditLog({
      action: 'UPDATE',
      entity: 'Vehicle',
      entityId: vehicle.id,
      details: JSON.stringify({ plate: vehicle.plate, updatedFields: Object.keys(body) }),
      userId: auth.payload.userId,
      officeId: existing.officeId,
    });

    return NextResponse.json({ success: true, data: vehicle });
  } catch (error) {
    logger.error('Update vehicle error:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { id } = await params;

    const existing = await db.vehicle.findUnique({ where: { id } });

    if (!existing || existing.deleted) {
      return NextResponse.json({ success: false, error: 'Veículo não encontrado' }, { status: 404 });
    }

    if (auth.payload.officeId !== existing.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    await db.vehicle.update({
      where: { id },
      data: { deleted: true },
    });

    await auditLog({
      action: 'DELETE',
      entity: 'Vehicle',
      entityId: id,
      details: JSON.stringify({ plate: existing.plate, brand: existing.brand, model: existing.model }),
      userId: auth.payload.userId,
      officeId: existing.officeId,
    });

    return NextResponse.json({ success: true, data: { message: 'Veículo removido com sucesso' } });
  } catch (error) {
    logger.error('Delete vehicle error:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}
