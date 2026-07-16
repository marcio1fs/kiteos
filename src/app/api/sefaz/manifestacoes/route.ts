/**
 * GET /api/sefaz/manifestacoes
 * Lista registros de Manifestação do Destinatário com paginação e filtros
 *
 * Query params: officeId, chave?, tipoEvento?, status?, page?, limit?
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const officeId = searchParams.get('officeId')
    const chave = searchParams.get('chave')
    const tipoEvento = searchParams.get('tipoEvento')
    const status = searchParams.get('status')
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)

    // Validação do officeId
    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      )
    }

    // Autenticação
    const auth = await requireAuth(request, officeId)
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      )
    }

    // Construir cláusula where
    const where: Record<string, unknown> = {
      officeId,
    }

    if (chave) {
      where.chave = {
        contains: chave.replace(/\D/g, ''),
      }
    }

    if (tipoEvento) {
      where.tipoEvento = tipoEvento
    }

    if (status) {
      where.status = status
    }

    // Calcular paginação
    const skip = (page - 1) * limit

    // Obter total de registros
    const total = await db.manifestacaoDestinatario.count({ where })

    // Obter registros
    const manifestacoes = await db.manifestacaoDestinatario.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      select: {
        id: true,
        chave: true,
        tipoEvento: true,
        codigoEvento: true,
        protocolo: true,
        dataEvento: true,
        justificativa: true,
        status: true,
        codigoRetorno: true,
        motivoRetorno: true,
        tentativas: true,
        erroMensagem: true,
        usuarioId: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    const totalPages = Math.ceil(total / limit)

    return NextResponse.json({
      success: true,
      data: manifestacoes,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    })
  } catch (error) {
    console.error('Erro ao listar manifestações do destinatário:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao listar manifestações do destinatário',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    )
  }
}
