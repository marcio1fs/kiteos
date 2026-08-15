import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { Prisma } from '@prisma/client';

// GET /api/cash-register - Get current cash register status and metrics for the logged seller
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');

    if (!officeId) {
      return NextResponse.json({ success: false, error: 'officeId é obrigatório' }, { status: 400 });
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    // Find active cash session for current user
    const activeSession = await db.cashSession.findFirst({
      where: {
        officeId,
        userId: auth.payload.userId,
        status: 'ABERTO',
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        movements: { orderBy: { createdAt: 'desc' } },
      },
    });

    if (!activeSession) {
      return NextResponse.json({
        success: true,
        isOpen: false,
        session: null,
      });
    }

    // Calculate totals from sales in this session
    const sessionSales = await db.sale.findMany({
      where: {
        officeId,
        cashSessionId: activeSession.id,
        status: 'PAGA',
        deleted: false,
      },
      select: {
        totalAmount: true,
        paymentMethod: true,
      },
    });

    let totalCashSales = 0;
    let totalPixSales = 0;
    let totalCardSales = 0;
    let totalOtherSales = 0;

    for (const sale of sessionSales) {
      const amount = Number(sale.totalAmount || 0);
      const method = (sale.paymentMethod || '').toUpperCase();
      if (method.includes('DINHEIRO')) {
        totalCashSales += amount;
      } else if (method.includes('PIX')) {
        totalPixSales += amount;
      } else if (method.includes('CARTAO') || method.includes('DEBITO') || method.includes('CREDITO')) {
        totalCardSales += amount;
      } else {
        totalOtherSales += amount;
      }
    }

    // Calculate movements (suprimentos vs sangrias)
    let totalSuprimentos = 0;
    let totalSangrias = 0;

    for (const mov of activeSession.movements) {
      const amount = Number(mov.amount || 0);
      if (mov.type === 'SUPRIMENTO') {
        totalSuprimentos += amount;
      } else if (mov.type === 'SANGRIA') {
        totalSangrias += amount;
      }
    }

    const initialBalance = Number(activeSession.initialBalance || 0);
    const expectedCashInHand = initialBalance + totalCashSales + totalSuprimentos - totalSangrias;
    const totalSalesAmount = totalCashSales + totalPixSales + totalCardSales + totalOtherSales;

    return NextResponse.json({
      success: true,
      isOpen: true,
      session: {
        ...activeSession,
        initialBalance,
        totalCashSales,
        totalPixSales,
        totalCardSales,
        totalOtherSales,
        totalSalesAmount,
        totalSuprimentos,
        totalSangrias,
        expectedCashInHand,
      },
    });
  } catch (error) {
    logger.error('Get cash register error:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao consultar status do caixa' }, { status: 500 });
  }
}

// POST /api/cash-register - Manage cash sessions (OPEN, CLOSE, MOVEMENT)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, action, initialBalance = 0, finalBalance, obs, type, amount, description } = body;

    if (!officeId || !action) {
      return NextResponse.json({ success: false, error: 'officeId e action são obrigatórios' }, { status: 400 });
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    // =========================================================================
    // ACTION: OPEN CAIXA
    // =========================================================================
    if (action === 'OPEN') {
      const existing = await db.cashSession.findFirst({
        where: { officeId, userId: auth.payload.userId, status: 'ABERTO' },
      });

      if (existing) {
        return NextResponse.json({ success: false, error: 'Você já possui um caixa aberto.' }, { status: 400 });
      }

      const session = await db.cashSession.create({
        data: {
          officeId,
          userId: auth.payload.userId,
          initialBalance: new Prisma.Decimal(initialBalance),
          status: 'ABERTO',
          obs: obs || null,
        },
      });

      await auditLog({
        action: 'CREATE',
        entity: 'CashSession',
        entityId: session.id,
        details: JSON.stringify({ action: 'OPEN', initialBalance }),
        userId: auth.payload.userId,
        officeId,
      });

      return NextResponse.json({ success: true, data: session }, { status: 201 });
    }

    // =========================================================================
    // ACTION: CLOSE CAIXA
    // =========================================================================
    if (action === 'CLOSE') {
      const activeSession = await db.cashSession.findFirst({
        where: { officeId, userId: auth.payload.userId, status: 'ABERTO' },
        include: { movements: true },
      });

      if (!activeSession) {
        return NextResponse.json({ success: false, error: 'Nenhum caixa aberto encontrado para fechar.' }, { status: 404 });
      }

      // Calculate cash sales
      const cashSales = await db.sale.aggregate({
        where: {
          officeId,
          cashSessionId: activeSession.id,
          status: 'PAGA',
          paymentMethod: { contains: 'DINHEIRO', mode: 'insensitive' },
          deleted: false,
        },
        _sum: { totalAmount: true },
      });

      const totalCashSales = Number(cashSales._sum.totalAmount || 0);
      const totalSuprimentos = activeSession.movements
        .filter((m) => m.type === 'SUPRIMENTO')
        .reduce((sum, m) => sum + Number(m.amount), 0);
      const totalSangrias = activeSession.movements
        .filter((m) => m.type === 'SANGRIA')
        .reduce((sum, m) => sum + Number(m.amount), 0);

      const expectedCash = Number(activeSession.initialBalance) + totalCashSales + totalSuprimentos - totalSangrias;
      const countedCash = Number(finalBalance || 0);

      const updatedSession = await db.cashSession.update({
        where: { id: activeSession.id },
        data: {
          status: 'FECHADO',
          closedAt: new Date(),
          finalBalance: new Prisma.Decimal(countedCash),
          expectedBalance: new Prisma.Decimal(expectedCash),
          obs: obs || null,
        },
      });

      await auditLog({
        action: 'UPDATE',
        entity: 'CashSession',
        entityId: updatedSession.id,
        details: JSON.stringify({ action: 'CLOSE', countedCash, expectedCash, diff: countedCash - expectedCash }),
        userId: auth.payload.userId,
        officeId,
      });

      return NextResponse.json({
        success: true,
        data: updatedSession,
        summary: {
          countedCash,
          expectedCash,
          divergence: countedCash - expectedCash,
        },
      });
    }

    // =========================================================================
    // ACTION: MOVEMENT (SANGRIA / SUPRIMENTO)
    // =========================================================================
    if (action === 'MOVEMENT') {
      if (!type || !amount || Number(amount) <= 0) {
        return NextResponse.json({ success: false, error: 'Tipo (SUPRIMENTO ou SANGRIA) e valor válido são obrigatórios' }, { status: 400 });
      }

      const activeSession = await db.cashSession.findFirst({
        where: { officeId, userId: auth.payload.userId, status: 'ABERTO' },
      });

      if (!activeSession) {
        return NextResponse.json({ success: false, error: 'Nenhum caixa aberto para registrar movimentação' }, { status: 400 });
      }

      const movement = await db.cashMovement.create({
        data: {
          type,
          amount: new Prisma.Decimal(amount),
          description: description || (type === 'SANGRIA' ? 'Sangria de Caixa' : 'Suprimento de Troco'),
          sessionId: activeSession.id,
          officeId,
        },
      });

      await auditLog({
        action: 'CREATE',
        entity: 'CashMovement',
        entityId: movement.id,
        details: JSON.stringify({ type, amount, description }),
        userId: auth.payload.userId,
        officeId,
      });

      return NextResponse.json({ success: true, data: movement }, { status: 201 });
    }

    return NextResponse.json({ success: false, error: 'Ação inválida' }, { status: 400 });
  } catch (error) {
    logger.error('Cash register operation error:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao processar operação do caixa' }, { status: 500 });
  }
}
