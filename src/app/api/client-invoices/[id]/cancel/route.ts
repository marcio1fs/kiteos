import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { auditLog } from '@/lib/auth';
import { INVOICE_CANCELLED_STATUS, cancelledInvoiceData, fiscalErrorResponse } from '@/lib/fiscal/document-status';

// POST /api/client-invoices/[id]/cancel - Cancel a client invoice
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { officeId, motivoCancelamento } = body;

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

    const invoice = await db.clientInvoice.findUnique({
      where: { id },
    });

    if (!invoice || invoice.officeId !== officeId || invoice.deleted) {
      return NextResponse.json(
        { success: false, error: 'Nota fiscal não encontrada' },
        { status: 404 }
      );
    }

    if (invoice.status === INVOICE_CANCELLED_STATUS) {
      return NextResponse.json(
        { success: false, error: 'Nota fiscal já está cancelada' },
        { status: 400 }
      );
    }

    // FISC-02: rascunho nunca transmitido é descartado localmente; nota autorizada
    // pela SEFAZ só cancela com prova de cancelamento (protocolo). Sem integração
    // configurada isso responde 501 em vez de gravar um cancelamento fictício.
    const cancellation = cancelledInvoiceData(invoice.status, null, motivoCancelamento || '');

    const updated = await db.clientInvoice.update({
      where: { id },
      data: cancellation.data,
      include: {
        items: { where: { deleted: false }, orderBy: { createdAt: 'asc' } },
        sale: { select: { id: true, number: true } },
        serviceOrder: { select: { id: true, number: true } },
        client: { select: { id: true, name: true, cpfCnpj: true } },
      },
    });

    await auditLog({
      action: cancellation.transmitted ? 'NFE_CANCELLED' : 'NFE_DRAFT_DISCARDED',
      entity: 'ClientInvoice',
      entityId: id,
      details: JSON.stringify({
        number: invoice.number,
        chave: invoice.chave,
        previousStatus: invoice.status,
        reason: cancellation.data.motivoCancelamento,
        protocol: cancellation.proof?.protocol ?? null,
        transmitted: cancellation.transmitted,
      }),
      userId: auth.payload.userId,
      officeId,
    });

    return NextResponse.json({
      success: true,
      transmitted: cancellation.transmitted,
      data: updated,
    });
  } catch (error) {
    const known = fiscalErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error canceling client invoice:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao cancelar nota fiscal' },
      { status: 500 }
    );
  }
}
