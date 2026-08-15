import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { logger } from '@/lib/logger';

// GET /api/client-invoices/[id] - Get invoice detail with items
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');

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
      include: {
        items: { where: { deleted: false }, orderBy: { createdAt: 'asc' } },
        sale: { select: { id: true, number: true } },
        serviceOrder: { select: { id: true, number: true } },
        client: { select: { id: true, name: true, cpfCnpj: true } },
        office: { select: { id: true, name: true, cnpj: true, email: true, phone: true, address: true, city: true, state: true, zipCode: true, logo: true } },
      },
    });

    if (!invoice || invoice.officeId !== officeId || invoice.deleted) {
      return NextResponse.json(
        { success: false, error: 'Nota fiscal não encontrada' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: invoice });
  } catch (error) {
    logger.error('Error getting client invoice:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar nota fiscal' },
      { status: 500 }
    );
  }
}

// PUT /api/client-invoices/[id] - Cancel invoice
export async function PUT(
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

    if (invoice.status === 'CANCELADA') {
      return NextResponse.json(
        { success: false, error: 'Nota fiscal já está cancelada' },
        { status: 400 }
      );
    }

    const updated = await db.clientInvoice.update({
      where: { id },
      data: {
        status: 'CANCELADA',
        dataCancelamento: new Date(),
        motivoCancelamento: motivoCancelamento || 'Cancelamento sem motivo informado',
      },
      include: {
        items: { where: { deleted: false }, orderBy: { createdAt: 'asc' } },
        sale: { select: { id: true, number: true } },
        serviceOrder: { select: { id: true, number: true } },
        client: { select: { id: true, name: true, cpfCnpj: true } },
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Error canceling client invoice:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao cancelar nota fiscal' },
      { status: 500 }
    );
  }
}
