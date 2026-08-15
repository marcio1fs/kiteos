import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/auth';
import { Prisma } from '@prisma/client';
import { isValidCNPJ } from '@/lib/server-validators';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const search = searchParams.get('search');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');

    if (!officeId) {
      return NextResponse.json({ success: false, error: 'officeId é obrigatório' }, { status: 400 });
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const where: Prisma.SupplierWhereInput = {
      officeId,
      deleted: false,
    };

    if (search) {
      where.OR = [
        { razaoSocial: { contains: search } },
        { nomeFantasia: { contains: search } },
        { cnpj: { contains: search } },
        { email: { contains: search } },
        { city: { contains: search } },
      ];
    }

    const [suppliers, total] = await Promise.all([
      db.supplier.findMany({
        where,
        include: {
          _count: {
            select: { parts: { where: { deleted: false } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.supplier.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: suppliers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('List suppliers error:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { cnpj, razaoSocial, nomeFantasia, email, phone, address, city, state, zipCode, ie, officeId } = body;

    if (!cnpj || !razaoSocial || !officeId) {
      return NextResponse.json(
        { success: false, error: 'CNPJ, razão social e officeId são obrigatórios' },
        { status: 400 }
      );
    }

    // Validate CNPJ format
    if (!isValidCNPJ(cnpj)) {
      return NextResponse.json(
        { success: false, error: 'CNPJ inválido' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    // Check CNPJ uniqueness within office
    const existing = await db.supplier.findFirst({
      where: { cnpj, officeId, deleted: false },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, error: 'CNPJ já cadastrado neste escritório' },
        { status: 409 }
      );
    }

    const supplier = await db.supplier.create({
      data: {
        cnpj,
        razaoSocial,
        nomeFantasia: nomeFantasia || null,
        email: email || null,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        ie: ie || null,
        officeId,
      },
    });

    await auditLog({
      action: 'CREATE',
      entity: 'Supplier',
      entityId: supplier.id,
      details: JSON.stringify({ razaoSocial: supplier.razaoSocial, cnpj: supplier.cnpj }),
      userId: auth.payload.userId,
      officeId,
    });

    return NextResponse.json({ success: true, data: supplier }, { status: 201 });
  } catch (error) {
    logger.error('Create supplier error:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}
