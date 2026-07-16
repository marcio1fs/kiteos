import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const status = searchParams.get('status');
    const chave = searchParams.get('chave');
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
      deleted: false, // QRY-05 FIX: Exclude soft-deleted consultas
    };

    if (status) {
      where.status = status;
    }

    if (chave) {
      where.chave = {
        contains: chave,
      };
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    // Get total count
    const total = await db.sefazConsulta.count({ where });

    // Get records
    const consultas = await db.sefazConsulta.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        chave: true,
        ambiente: true,
        protocolo: true,
        status: true,
        fornecedorCnpj: true,
        xmlArmazenado: true,
        codigoStatus: true,
        motivoStatus: true,
        tempoResposta: true,
        tentativas: true,
        erroAmigavel: true,
        usuarioId: true,
        invoiceId: true,
        createdAt: true,
        // NOTA: xmlContent e erroMensagem são intencionalmente omitidos
        // da listagem para não expor dados sensíveis. Use o endpoint
        // de detalhe para obter o XML completo.
      },
    });

    const totalPages = Math.ceil(total / limit);

    return NextResponse.json({
      success: true,
      data: consultas,
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
    console.error('Erro ao listar consultas SEFAZ:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao listar consultas SEFAZ',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
