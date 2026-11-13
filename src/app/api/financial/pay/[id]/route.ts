import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { CommercialError, commercialErrorResponse, paymentMethodSchema } from '@/lib/commercial';
import { z } from 'zod';

const bodySchema = z.object({ paymentMethod: paymentMethodSchema }).strict();

// PUT /api/financial/pay/[id] - Mark entry as paid (ADMIN/OWNER, atomic CAS)
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request, undefined, 'ADMIN');
    if (!auth.payload) return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    const { id } = await params;
    const { paymentMethod } = bodySchema.parse(await request.json());
    const officeId = auth.payload.officeId;

    const entry = await db.$transaction(async (tx) => {
      const existing = await tx.financialEntry.findFirst({ where: { id, officeId, deleted: false } });
      if (!existing) throw new CommercialError('Entrada financeira não encontrada', 404);
      if (existing.status === 'PAGO') throw new CommercialError('Entrada financeira já está paga', 409);
      if (existing.status === 'CANCELADO') throw new CommercialError('Não é possível pagar uma entrada cancelada', 409);

      const claimed = await tx.financialEntry.updateMany({
        where: { id, officeId, deleted: false, status: { in: ['PENDENTE', 'ATRASADO'] } },
        data: { status: 'PAGO', paymentDate: new Date(), paymentMethod },
      });
      if (claimed.count !== 1) throw new CommercialError('Lançamento alterado por outra operação. Recarregue e tente novamente.', 409);

      await tx.auditLog.create({
        data: {
          action: 'PAYMENT_APPROVED', entity: 'FinancialEntry', entityId: id,
          details: JSON.stringify({ amount: Number(existing.totalAmount), paymentMethod, type: existing.type }),
          userId: auth.payload.userId, officeId,
        },
      });
      return tx.financialEntry.findFirst({
        where: { id, officeId },
        include: { supplier: { select: { id: true, razaoSocial: true, nomeFantasia: true, cnpj: true } } },
      });
    });

    return NextResponse.json({ success: true, data: entry });
  } catch (error) {
    const known = commercialErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error marking financial entry as paid:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao marcar entrada como paga' }, { status: 500 });
  }
}
