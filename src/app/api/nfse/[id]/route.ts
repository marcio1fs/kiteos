import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { cancelNfse } from '@/lib/fiscal/nfse-transmission';
import { fiscalErrorResponse } from '@/lib/fiscal/document-status';

// GET /api/nfse/[id] - Get NFS-e details
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

    const nfse = await db.nfseServico.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true, cpfCnpj: true, email: true, phone: true, address: true } },
        office: { select: { id: true, name: true, cnpj: true, email: true, phone: true, address: true, city: true, state: true, zipCode: true } },
      },
    });

    if (!nfse || nfse.officeId !== officeId || nfse.deleted) {
      return NextResponse.json(
        { success: false, error: 'NFS-e não encontrada' },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, data: nfse });
  } catch (error) {
    logger.error('Error getting NFS-e:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar NFS-e' },
      { status: 500 }
    );
  }
}

// DELETE /api/nfse/[id] - descartar RPS ou cancelar NFS-e autorizada.
//
// FISC-01: antes isto gravava CANCELADA em qualquer status, inclusive numa NFS-e
// que nunca foi transmitida (nada a cancelar no município) e — pior — numa
// "EMITIDA" fictícia. Agora: RPS é descartado localmente (nunca houve autorização)
// e documento autorizado só cancela com prova de cancelamento do município.
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const motivoCancelamento = searchParams.get('motivoCancelamento') ?? '';

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

    const result = await cancelNfse(
      id,
      { userId: auth.payload.userId, officeId },
      motivoCancelamento,
    );

    return NextResponse.json({
      success: true,
      alreadyCancelled: result.alreadyCancelled,
      data: result.nfse,
    });
  } catch (error) {
    const known = fiscalErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    if (error instanceof Error && error.message === 'NFS-e não encontrada') {
      return NextResponse.json({ success: false, error: error.message }, { status: 404 });
    }
    logger.error('Error canceling NFS-e:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao cancelar NFS-e' },
      { status: 500 }
    );
  }
}
