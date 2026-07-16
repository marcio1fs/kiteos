import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/auth';
import { isValidCPFCNPJ } from '@/lib/server-validators';
import { sanitizeString } from '@/lib/sanitize';

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

    const client = await db.client.findUnique({
      where: { id },
      include: {
        vehicles: {
          where: { deleted: false },
        },
        serviceOrders: {
          where: { deleted: false },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            vehicle: true,
          },
        },
      },
    });

    if (!client || client.deleted) {
      return NextResponse.json({ success: false, error: 'Cliente não encontrado' }, { status: 404 });
    }

    // Validate office belongs to user
    if (auth.payload.officeId !== client.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    return NextResponse.json({ success: true, data: client });
  } catch (error) {
    console.error('Get client error: [REDACTED]');
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

    // Check client exists and belongs to user's office
    const existing = await db.client.findUnique({ where: { id } });

    if (!existing || existing.deleted) {
      return NextResponse.json({ success: false, error: 'Cliente não encontrado' }, { status: 404 });
    }

    if (auth.payload.officeId !== existing.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Check cpfCnpj uniqueness if changing
    if (body.cpfCnpj && body.cpfCnpj !== existing.cpfCnpj) {
      // Validate CPF/CNPJ format
      if (!isValidCPFCNPJ(body.cpfCnpj)) {
        return NextResponse.json(
          { success: false, error: 'CPF/CNPJ inválido' },
          { status: 400 }
        );
      }
      const duplicate = await db.client.findFirst({
        where: {
          cpfCnpj: body.cpfCnpj,
          officeId: existing.officeId,
          deleted: false,
          id: { not: id },
        },
      });
      if (duplicate) {
        return NextResponse.json(
          { success: false, error: 'CPF/CNPJ já cadastrado neste escritório' },
          { status: 409 }
        );
      }
    }

    // CLI-01 FIX: Apply sanitizeString to text fields in PUT
    const client = await db.client.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: sanitizeString(body.name) }),
        ...(body.cpfCnpj !== undefined && { cpfCnpj: body.cpfCnpj || null }),
        ...(body.email !== undefined && { email: body.email ? sanitizeString(body.email) : null }),
        ...(body.phone !== undefined && { phone: body.phone ? sanitizeString(body.phone) : null }),
        ...(body.address !== undefined && { address: body.address ? sanitizeString(body.address) : null }),
        ...(body.city !== undefined && { city: body.city || null }),
        ...(body.state !== undefined && { state: body.state || null }),
        ...(body.zipCode !== undefined && { zipCode: body.zipCode || null }),
      },
    });

    await auditLog({
      action: 'UPDATE',
      entity: 'Client',
      entityId: client.id,
      details: JSON.stringify({ name: client.name, updatedFields: Object.keys(body) }),
      userId: auth.payload.userId,
      officeId: existing.officeId,
    });

    return NextResponse.json({ success: true, data: client });
  } catch (error) {
    console.error('Update client error: [REDACTED]');
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

    const existing = await db.client.findUnique({ where: { id } });

    if (!existing || existing.deleted) {
      return NextResponse.json({ success: false, error: 'Cliente não encontrado' }, { status: 404 });
    }

    if (auth.payload.officeId !== existing.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Soft delete client and their vehicles
    await db.$transaction([
      db.client.update({
        where: { id },
        data: { deleted: true },
      }),
      db.vehicle.updateMany({
        where: { clientId: id },
        data: { deleted: true },
      }),
    ]);

    await auditLog({
      action: 'DELETE',
      entity: 'Client',
      entityId: id,
      details: JSON.stringify({ name: existing.name }),  // SECURITY FIX (#69): Don't log cpfCnpj
      userId: auth.payload.userId,
      officeId: existing.officeId,
    });

    return NextResponse.json({ success: true, data: { message: 'Cliente removido com sucesso' } });
  } catch (error) {
    console.error('Delete client error: [REDACTED]');
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}
