import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';

// GET /api/financial - List financial entries
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const type = searchParams.get('type'); // PAGAR, RECEBER
    const status = searchParams.get('status'); // PENDENTE, PAGO, ATRASADO, CANCELADO
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const category = searchParams.get('category'); // ASSINATURA, OS, NF, OUTROS

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

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (category) {
      where.category = category;
    }

    if (dateFrom || dateTo) {
      const dueDateFilter: Record<string, unknown> = {};
      if (dateFrom) {
        dueDateFilter.gte = new Date(dateFrom);
      }
      if (dateTo) {
        dueDateFilter.lte = new Date(dateTo);
      }
      where.dueDate = dueDateFilter;
    }

    // Auto-update overdue entries before returning
    const now = new Date();
    await db.financialEntry.updateMany({
      where: {
        officeId,
        deleted: false,
        status: 'PENDENTE',
        dueDate: { lt: now },
      },
      data: {
        status: 'ATRASADO',
      },
    });

    // SECURITY FIX: Add pagination to prevent memory exhaustion (#65)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const skip = (page - 1) * limit;

    const [entries, total] = await Promise.all([
      db.financialEntry.findMany({
        where,
        include: {
          supplier: {
            select: {
              id: true,
              razaoSocial: true,
              nomeFantasia: true,
              cnpj: true,
            },
          },
        },
        orderBy: {
          dueDate: 'asc',
        },
        skip,
        take: limit,
      }),
      db.financialEntry.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: entries,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    logger.error('Error listing financial entries: [REDACTED]', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao listar entradas financeiras' },
      { status: 500 }
    );
  }
}

// POST /api/financial - Create financial entry manually
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      officeId,
      type,
      category,
      description,
      amount,
      discount = 0,
      interest = 0,
      dueDate,
      paymentMethod,
      reference,
      supplierId,
    } = body;

    // Validations
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

    if (!type || !['PAGAR', 'RECEBER'].includes(type)) {
      return NextResponse.json(
        { success: false, error: 'type deve ser PAGAR ou RECEBER' },
        { status: 400 }
      );
    }

    // SECURITY FIX: Validate category against whitelist (#55)
    const VALID_CATEGORIES = ['ASSINATURA', 'OS', 'NF', 'PDV', 'OUTROS', 'ALUGUEL', 'SALARIOS', 'IMPOSTOS', 'ENERGIA', 'COMBUSTIVEL', 'MANUTENCAO', 'SEGURO'];
    if (category && !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { success: false, error: `Categoria inválida. Categorias válidas: ${VALID_CATEGORIES.join(', ')}` },
        { status: 400 }
      );
    }

    if (!description) {
      return NextResponse.json(
        { success: false, error: 'description é obrigatória' },
        { status: 400 }
      );
    }

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { success: false, error: 'amount deve ser maior que zero' },
        { status: 400 }
      );
    }

    // ============================================================================
    // SECURITY FIX: Validate maximum amount to prevent financial fraud
    // ============================================================================
    if (amount > 999999.99) {
      return NextResponse.json(
        { success: false, error: 'amount excede o limite máximo permitido (R$ 999.999,99)' },
        { status: 400 }
      );
    }

    // ============================================================================
    // SECURITY FIX: Validate totalAmount is not negative
    // discount > amount + interest would create a negative entry
    // ============================================================================
    const totalAmount = amount - discount + interest;
    if (totalAmount < 0) {
      return NextResponse.json(
        { success: false, error: 'totalAmount não pode ser negativo (desconto maior que valor + juros)' },
        { status: 400 }
      );
    }

    if (!dueDate) {
      return NextResponse.json(
        { success: false, error: 'dueDate é obrigatória' },
        { status: 400 }
      );
    }

    if (discount < 0) {
      return NextResponse.json(
        { success: false, error: 'discount não pode ser negativo' },
        { status: 400 }
      );
    }

    if (interest < 0) {
      return NextResponse.json(
        { success: false, error: 'interest não pode ser negativo' },
        { status: 400 }
      );
    }

    // Calculate totalAmount: amount - discount + interest
    // (moved above for validation)

    // Auto-set status based on dueDate vs current date
    const now = new Date();
    const dueDateObj = new Date(dueDate);
    let status: string = 'PENDENTE';
    if (dueDateObj < now) {
      status = 'ATRASADO';
    }

    const entry = await db.financialEntry.create({
      data: {
        officeId,
        type,
        category: category || 'OUTROS',
        description,
        amount,
        discount,
        interest,
        totalAmount,
        status,
        dueDate: dueDateObj,
        paymentMethod: paymentMethod || null,
        reference: reference || null,
        supplierId: supplierId || null,
      },
      include: {
        supplier: {
          select: {
            id: true,
            razaoSocial: true,
            nomeFantasia: true,
            cnpj: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: entry,
    });
  } catch (error) {
    logger.error('Error creating financial entry: [REDACTED]', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao criar entrada financeira' },
      { status: 500 }
    );
  }
}
