import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { requireAuth } from '@/lib/auth';
import { reverseSale } from '@/lib/sales';
import { commercialErrorResponse, idSchema, paymentMethodSchema } from '@/lib/commercial';

/**
 * A reversal is an audit event, so the reason is mandatory and free-text is
 * capped: an estorno without justification is exactly the hole BIZ-05/BIZ-07
 * were about. `paymentMethod` is optional and only records how the money went
 * back (card refund, cash, transfer).
 */
const bodySchema = z.object({
  reason: z.string().trim().min(3, 'Informe o motivo do estorno').max(500),
  paymentMethod: paymentMethodSchema.optional(),
});

// POST /api/sales/[id]/estorno - reverse a PAID sale: money back on the ledger,
// stock back on the shelf, sale marked ESTORNADA. Nothing is deleted, and the
// settled launch stays in the books as ESTORNADO next to its compensating entry.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    // ADMIN minimum: an EMPLOYEE cannot reverse settled money.
    const auth = await requireAuth(request, undefined, 'ADMIN');
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { id } = await params;
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json({ success: false, error: 'Identificador de venda inválido' }, { status: 400 });
    }

    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Dados de estorno inválidos', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    // officeId comes from the verified token, never from the body: a reversal
    // cannot be pointed at another tenant's sale.
    const result = await reverseSale(
      parsedId.data,
      auth.payload.officeId,
      { userId: auth.payload.userId, role: auth.payload.role },
      parsed.data,
    );

    return NextResponse.json({
      success: true,
      alreadyReversed: result.alreadyReversed,
      data: result,
    });
  } catch (error) {
    const known = commercialErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error reversing sale:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro ao estornar venda' }, { status: 500 });
  }
}
