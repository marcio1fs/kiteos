import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getObrigacoesFromService } from '@/lib/fiscal/obrigacoes-service';

// GET /api/fiscal/obrigacoes - List fiscal obligations with status
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const status = searchParams.get('status');
    const tipo = searchParams.get('tipo');

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

    let obrigacoes = await getObrigacoesFromService(officeId);

    // Filter by status
    if (status) {
      obrigacoes = obrigacoes.filter(o => o.status === status);
    }

    // Filter by type
    if (tipo) {
      obrigacoes = obrigacoes.filter(o => o.tipo === tipo);
    }

    // Summary counts
    const pendentes = obrigacoes.filter(o => o.status === 'PENDENTE').length;
    const atrasadas = obrigacoes.filter(o => o.status === 'ATRASADA').length;
    const entregues = obrigacoes.filter(o => o.status === 'ENTREGUE').length;

    return NextResponse.json({
      success: true,
      data: {
        obrigacoes,
        resumo: { pendentes, atrasadas, entregues, total: obrigacoes.length },
      },
    });
  } catch (error) {
    console.error('Error listing fiscal obligations:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao listar obrigações fiscais' },
      { status: 500 }
    );
  }
}
