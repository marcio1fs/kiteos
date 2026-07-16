import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// PUT /api/financial/pay/[id] - Mark entry as paid
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { paymentMethod } = body;

    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    // ============================================================================
    // SECURITY FIX: Only ADMIN or OWNER can mark entries as paid
    // EMPLOYEE should not be able to approve payments (segregation of duties)
    // ============================================================================
    if (auth.payload.role === 'EMPLOYEE') {
      return NextResponse.json(
        { success: false, error: 'Funcionários não podem aprovar pagamentos' },
        { status: 403 }
      );
    }

    // Check if entry exists and is not deleted
    const existing = await db.financialEntry.findFirst({
      where: { id, deleted: false },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Entrada financeira não encontrada' },
        { status: 404 }
      );
    }

    // Check ownership
    if (existing.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Check if already paid
    if (existing.status === 'PAGO') {
      return NextResponse.json(
        { success: false, error: 'Entrada financeira já está paga' },
        { status: 400 }
      );
    }

    // Check if cancelled
    if (existing.status === 'CANCELADO') {
      return NextResponse.json(
        { success: false, error: 'Não é possível pagar uma entrada cancelada' },
        { status: 400 }
      );
    }

    // ============================================================================
    // SECURITY FIX: Validate paymentMethod is one of the allowed values
    // ============================================================================
    const validPaymentMethods = ['PIX', 'CARTAO', 'DINHEIRO', 'BOLETO', 'TRANSFERENCIA', 'MERCADO_PAGO', 'OUTRO'];
    if (paymentMethod && !validPaymentMethods.includes(paymentMethod)) {
      return NextResponse.json(
        { success: false, error: `Método de pagamento inválido. Válidos: ${validPaymentMethods.join(', ')}` },
        { status: 400 }
      );
    }

    const now = new Date();

    const updateData: Record<string, unknown> = {
      status: 'PAGO',
      paymentDate: now,
    };

    if (paymentMethod) {
      updateData.paymentMethod = paymentMethod;
    }

    const entry = await db.financialEntry.update({
      where: { id },
      data: updateData,
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

    // ============================================================================
    // AUD-C07 FIX: Moved audit log BEFORE return — was dead code after return
    // ============================================================================
    await db.auditLog.create({
      data: {
        action: 'PAYMENT_APPROVED',
        entity: 'FinancialEntry',
        entityId: id,
        details: JSON.stringify({
          amount: existing.totalAmount,
          paymentMethod: paymentMethod || existing.paymentMethod,
          type: existing.type,
        }),
        userId: auth.payload.userId,
        officeId: existing.officeId,
      },
    });

    return NextResponse.json({
      success: true,
      data: entry,
    });

  } catch (error) {
    console.error('Error marking financial entry as paid:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao marcar entrada como paga' },
      { status: 500 }
    );
  }
}
