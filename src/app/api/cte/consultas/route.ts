import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const status = searchParams.get('status');
    const chave = searchParams.get('chave');
    const emitenteCnpj = searchParams.get('emitenteCnpj');
    const tipoCte = searchParams.get('tipoCte');
    const modal = searchParams.get('modal');
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    // Build where clause
    const where: Record<string, unknown> = {
      officeId,
      deleted: false,
    };

    if (status) {
      where.status = status;
    }

    if (chave) {
      where.chave = {
        contains: chave,
      };
    }

    if (emitenteCnpj) {
      where.emitenteCnpj = emitenteCnpj;
    }

    if (tipoCte) {
      where.tipoCte = tipoCte;
    }

    if (modal) {
      where.modal = modal;
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get total count
    const total = await db.conhecimentoTransporte.count({ where });

    // Get records
    const conhecimentos = await db.conhecimentoTransporte.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        chave: true,
        numero: true,
        serie: true,
        dataEmissao: true,
        tipoCte: true,
        modal: true,
        naturezaOperacao: true,
        emitenteCnpj: true,
        emitenteRazao: true,
        destinatarioCnpj: true,
        destinatarioRazao: true,
        valorTotal: true,
        valorImpostos: true,
        status: true,
        nfeVinculadas: true,
        observacao: true,
        supplierId: true,
        createdAt: true,
        updatedAt: true,
        // NOTA: xmlContent é intencionalmente omitido da listagem
        // para não expor dados pesados. Use o endpoint de detalhe
        // para obter o XML completo.
        supplier: {
          select: {
            id: true,
            razaoSocial: true,
            cnpj: true,
          },
        },
      },
    });

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      success: true,
      data: conhecimentos,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });

  } catch (error) {
    console.error('Erro ao listar CT-e:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao listar Conhecimentos de Transporte',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
