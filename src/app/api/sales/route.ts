import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';
import { createSale, createSaleSchema } from '@/lib/sales';
import { commercialErrorResponse } from '@/lib/commercial';

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

    const userIdFilter = searchParams.get('userId');

    const where: Prisma.SaleWhereInput = {
      officeId,
      deleted: false,
    };

    if (status) {
      where.status = status;
    }

    if (userIdFilter) {
      where.userId = userIdFilter;
    }

    if (search) {
      where.OR = [
        { number: { contains: search } },
        { client: { name: { contains: search } } },
        { user: { name: { contains: search } } },
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
        user: {
          select: { id: true, name: true, email: true },
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
    logger.error('Error listing sales:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao listar vendas' },
      { status: 500 }
    );
  }
}

// POST /api/sales - Create sale (PDV)
export async function POST(request: NextRequest) {
  try {
    const input = createSaleSchema.parse(await request.json());
    const auth = await requireAuth(request, input.officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }
    const sale = await createSale(input, auth.payload);
    return NextResponse.json({ success: true, data: sale }, { status: 201 });
  } catch (error) {
    const known = commercialErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error creating sale:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao criar venda' }, { status: 500 });
  }
}
