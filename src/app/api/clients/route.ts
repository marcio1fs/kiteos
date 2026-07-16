import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { isValidCPFCNPJ } from '@/lib/server-validators';
import { sanitizeString, SANITIZABLE_FIELDS } from '@/lib/sanitize';

// SEC-08 FIX: Migrated from verifyToken+getTokenFromHeaders to requireAuth
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
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

    const where: Prisma.ClientWhereInput = {
      officeId,
      deleted: false,
    };

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { cpfCnpj: { contains: search } },
        { email: { contains: search } },
        { phone: { contains: search } },
      ];
    }

    const [clients, total] = await Promise.all([
      db.client.findMany({
        where,
        include: {
          vehicles: {
            where: { deleted: false },
            select: { id: true, plate: true, brand: true, model: true, year: true, color: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.client.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: clients,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('List clients error:', error);
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
    const { name, cpfCnpj, email, phone, address, city, state, zipCode, officeId } = body;

    if (!name || !officeId) {
      return NextResponse.json(
        { success: false, error: 'Nome e officeId são obrigatórios' },
        { status: 400 }
      );
    }

    // Validate office belongs to user
    if (auth.payload.officeId !== officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado a este escritório' }, { status: 403 });
    }

    // Check cpfCnpj uniqueness within office if provided
    if (cpfCnpj) {
      // Validate CPF/CNPJ format
      if (!isValidCPFCNPJ(cpfCnpj)) {
        return NextResponse.json(
          { success: false, error: 'CPF/CNPJ inválido' },
          { status: 400 }
        );
      }
      const existing = await db.client.findFirst({
        where: { cpfCnpj, officeId, deleted: false },
      });
      if (existing) {
        return NextResponse.json(
          { success: false, error: 'CPF/CNPJ já cadastrado neste escritório' },
          { status: 409 }
        );
      }
    }

    // SECURITY FIX (AUD-01): Sanitize text inputs to prevent stored XSS
    const client = await db.client.create({
      data: {
        name: sanitizeString(name),
        cpfCnpj: cpfCnpj || null,
        email: email ? sanitizeString(email) : null,
        phone: phone ? sanitizeString(phone) : null,
        address: address ? sanitizeString(address) : null,
        city: city ? sanitizeString(city) : null,
        state: state ? sanitizeString(state) : null,
        zipCode: zipCode ? sanitizeString(zipCode) : null,
        officeId,
      },
    });

    await auditLog({
      action: 'CREATE',
      entity: 'Client',
      entityId: client.id,
      details: JSON.stringify({ name: client.name, cpfCnpj: client.cpfCnpj }),
      userId: auth.payload.userId,
      officeId,
    });

    return NextResponse.json({ success: true, data: client }, { status: 201 });
  } catch (error) {
    console.error('Create client error:', error);
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}
