import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { createSale, createSaleSchema } from '@/lib/sales';
import { commercialErrorResponse } from '@/lib/commercial';

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

// POST /api/pdv - Create a new sale (same transactional rules as /api/sales)
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
