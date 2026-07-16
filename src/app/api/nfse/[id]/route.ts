import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/auth';

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
    console.error('Error getting NFS-e:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar NFS-e' },
      { status: 500 }
    );
  }
}

// DELETE /api/nfse/[id] - Cancel NFS-e (sets status=CANCELADA)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const motivoCancelamento = searchParams.get('motivoCancelamento') || 'Cancelamento sem motivo informado';

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
    });

    if (!nfse || nfse.officeId !== officeId || nfse.deleted) {
      return NextResponse.json(
        { success: false, error: 'NFS-e não encontrada' },
        { status: 404 }
      );
    }

    if (nfse.status === 'CANCELADA') {
      return NextResponse.json(
        { success: false, error: 'NFS-e já está cancelada' },
        { status: 400 }
      );
    }

    const updated = await db.nfseServico.update({
      where: { id },
      data: {
        status: 'CANCELADA',
        motivoCancelamento,
      },
      include: {
        client: { select: { id: true, name: true, cpfCnpj: true } },
      },
    });

    // Audit log
    await auditLog({
      action: 'CANCEL',
      entity: 'NfseServico',
      entityId: id,
      details: JSON.stringify({ numero: nfse.numero, motivoCancelamento }),
      userId: auth.payload.userId,
      officeId,
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error canceling NFS-e:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao cancelar NFS-e' },
      { status: 500 }
    );
  }
}
