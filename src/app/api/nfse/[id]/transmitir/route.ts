import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { requireAuth } from '@/lib/auth';
import { cancelNfse, transmitNfse } from '@/lib/fiscal/nfse-transmission';
import { fiscalErrorResponse } from '@/lib/fiscal/document-status';
import { idSchema } from '@/lib/commercial';

/**
 * POST /api/nfse/[id]/transmitir — transmite o RPS ao município.
 *
 * É o único caminho que leva uma NFS-e a `EMITIDA`, e ele exige prova de
 * autorização (protocolo + código de verificação devolvidos pelo município).
 * Sem provedor configurado a rota responde `501 PROVIDER_NOT_INTEGRATED` e o
 * documento continua RPS: o sistema não finge mais ter emitido (FISC-01).
 *
 * O motivo do `DELETE` ficar aqui também é pragmático: reenvio e cancelamento
 * pertencem ao mesmo ciclo de vida e ambos precisam da mesma máquina de estados.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsedId = idSchema.safeParse(id);
    if (!parsedId.success) {
      return NextResponse.json(
        { success: false, error: 'Identificador de NFS-e inválido' },
        { status: 400 },
      );
    }

    // officeId vem do token: transmissão não pode ser apontada para outro tenant.
    const auth = await requireAuth(request, undefined, 'ADMIN');
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const body = (await request.json().catch(() => ({}))) as { action?: string; motivo?: string };
    const actor = { userId: auth.payload.userId, officeId: auth.payload.officeId };

    if (body?.action === 'cancelar') {
      const result = await cancelNfse(parsedId.data, actor, body.motivo ?? '');
      return NextResponse.json({
        success: true,
        alreadyCancelled: result.alreadyCancelled,
        data: result.nfse,
      });
    }

    const result = await transmitNfse(parsedId.data, actor);
    return NextResponse.json({
      success: true,
      alreadyTransmitted: result.alreadyTransmitted,
      data: result.nfse,
    });
  } catch (error) {
    const known = fiscalErrorResponse(error);
    if (known) return NextResponse.json(known.body, { status: known.status });
    logger.error('Error transmitting NFS-e:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao transmitir NFS-e' },
      { status: 500 },
    );
  }
}
