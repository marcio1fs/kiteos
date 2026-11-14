import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { CommercialError, commercialErrorResponse, idSchema, moneySchema, paymentMethodSchema, toCents, fromCents } from '@/lib/commercial';
import { z } from 'zod';

// GET /api/financial/[id] - Get financial entry by id
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

    const entry = await db.financialEntry.findFirst({
      where: {
        id,
        officeId: auth.payload.officeId,
        deleted: false,
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
        office: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!entry) {
      return NextResponse.json(
        { success: false, error: 'Entrada financeira não encontrada' },
        { status: 404 }
      );
    }

    if (entry.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Auto-check if overdue
    const now = new Date();
    if (entry.status === 'PENDENTE' && entry.dueDate < now) {
      const updated = await db.financialEntry.update({
        where: { id: entry.id },
        data: { status: 'ATRASADO' },
        include: {
          supplier: {
            select: {
              id: true,
              razaoSocial: true,
              nomeFantasia: true,
              cnpj: true,
            },
          },
          office: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      return NextResponse.json({
        success: true,
        data: updated,
      });
    }

    return NextResponse.json({
      success: true,
      data: entry,
    });
  } catch (error) {
    logger.error('Error getting financial entry:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar entrada financeira' },
      { status: 500 }
    );
  }
}

const updateSchema = z.object({
  type: z.enum(['PAGAR', 'RECEBER']).optional(),
  category: z.string().trim().max(100).nullish(),
  description: z.string().trim().min(1).max(500).optional(),
  amount: moneySchema.refine(v => v > 0, 'amount deve ser maior que zero').optional(),
  discount: moneySchema.optional(),
  interest: moneySchema.optional(),
  dueDate: z.string().datetime().optional(),
  paymentMethod: paymentMethodSchema.nullish(),
  reference: z.string().max(200).nullish(),
  supplierId: idSchema.nullish(),
  status: z.enum(['PENDENTE', 'ATRASADO']).optional(),
}).strict();

// PUT /api/financial/[id] - Update an unpaid, manually-managed entry
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request, undefined, 'ADMIN');
    if (!auth.payload) return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    const { id } = await params;
    const input = updateSchema.parse(await request.json());
    const officeId = auth.payload.officeId;

    const entry = await db.$transaction(async (tx) => {
      const existing = await tx.financialEntry.findFirst({ where: { id, officeId, deleted: false } });
      if (!existing) throw new CommercialError('Entrada financeira não encontrada', 404);
      if (existing.status === 'PAGO') throw new CommercialError('Não é possível editar uma entrada já paga', 409);
      if (existing.status === 'CANCELADO') throw new CommercialError('Não é possível editar uma entrada cancelada', 409);
      if (existing.saleId) throw new CommercialError('Lançamentos gerados por vendas são alterados apenas pelo fluxo de vendas', 409);

      if (input.supplierId) {
        const supplier = await tx.supplier.findFirst({ where: { id: input.supplierId, officeId, deleted: false } });
        if (!supplier) throw new CommercialError('Fornecedor não encontrado nesta oficina', 404);
      }

      const amountCents = toCents(input.amount ?? Number(existing.amount));
      const discountCents = toCents(input.discount ?? Number(existing.discount));
      const interestCents = toCents(input.interest ?? Number(existing.interest));
      if (discountCents > amountCents) throw new CommercialError('Desconto não pode ser maior que o valor', 400);
      const totalCents = amountCents - discountCents + interestCents;
      const dueDate = input.dueDate ? new Date(input.dueDate) : existing.dueDate;
      let status = input.status ?? existing.status;
      if (status === 'PENDENTE' && dueDate < new Date()) status = 'ATRASADO';
      if (status === 'ATRASADO' && dueDate >= new Date()) status = 'PENDENTE';

      const claimed = await tx.financialEntry.updateMany({
        where: { id, officeId, deleted: false, status: { in: ['PENDENTE', 'ATRASADO'] } },
        data: {
          type: input.type ?? existing.type,
          category: input.category !== undefined ? input.category : existing.category,
          description: input.description ?? existing.description,
          amount: fromCents(amountCents), discount: fromCents(discountCents), interest: fromCents(interestCents),
          totalAmount: fromCents(totalCents), dueDate, status,
          paymentMethod: input.paymentMethod !== undefined ? input.paymentMethod : existing.paymentMethod,
          reference: input.reference !== undefined ? input.reference : existing.reference,
          supplierId: input.supplierId !== undefined ? input.supplierId : existing.supplierId,
        },
      });
      if (claimed.count !== 1) throw new CommercialError('Lançamento alterado por outra operação. Recarregue e tente novamente.', 409);
      await tx.auditLog.create({
        data: { action: 'UPDATE', entity: 'FinancialEntry', entityId: id, details: JSON.stringify({ totalAmount: fromCents(totalCents) }), userId: auth.payload.userId, officeId },
      });
      return tx.financialEntry.findFirst({ where: { id, officeId }, include: { supplier: { select: { id: true, razaoSocial: true, nomeFantasia: true, cnpj: true } } } });
    });

    return NextResponse.json({ success: true, data: entry });
  } catch (error) {
    const known = commercialErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error updating financial entry:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao atualizar entrada financeira' }, { status: 500 });
  }
}

// DELETE /api/financial/[id] - Cancel an unpaid manual entry; paid entries are immutable.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuth(request, undefined, 'ADMIN');
    if (!auth.payload) return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    const { id } = await params;
    const officeId = auth.payload.officeId;

    await db.$transaction(async (tx) => {
      const existing = await tx.financialEntry.findFirst({ where: { id, officeId, deleted: false } });
      if (!existing) throw new CommercialError('Entrada financeira não encontrada', 404);
      if (existing.status === 'PAGO') throw new CommercialError('Não é possível excluir uma entrada paga. Registre o estorno antes de cancelar.', 409);
      if (existing.saleId) throw new CommercialError('Lançamentos gerados por vendas devem ser cancelados pelo fluxo de vendas', 409);
      const claimed = await tx.financialEntry.updateMany({
        where: { id, officeId, deleted: false, status: { in: ['PENDENTE', 'ATRASADO', 'CANCELADO'] } },
        data: { deleted: true, status: 'CANCELADO' },
      });
      if (claimed.count !== 1) throw new CommercialError('Lançamento alterado por outra operação', 409);
      await tx.auditLog.create({
        data: { action: 'DELETE', entity: 'FinancialEntry', entityId: id, details: JSON.stringify({ previousStatus: existing.status }), userId: auth.payload.userId, officeId },
      });
    });

    return NextResponse.json({ success: true, data: { message: 'Entrada financeira cancelada com sucesso' } });
  } catch (error) {
    const known = commercialErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error deleting financial entry:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao remover entrada financeira' }, { status: 500 });
  }
}
