import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { requireAuth } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { applyRateLimit } from '@/lib/sefaz/rate-limiter'
import { generateSpedFiscalPreview, type SpedGeneratorConfig } from '@/lib/sped'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { officeId, competencia } = body

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      )
    }

    if (!competencia) {
      return NextResponse.json(
        { success: false, error: 'competência é obrigatória (formato AAAAMM)' },
        { status: 400 }
      )
    }

    // Validate competencia format
    if (!/^\d{6}$/.test(competencia)) {
      return NextResponse.json(
        { success: false, error: 'Competência inválida. Use o formato AAAAMM (ex: 202401).' },
        { status: 400 }
      )
    }

    // Authentication
    const auth = await requireAuth(request, officeId)
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      )
    }

    // Rate limiting
    const rateLimitResult = applyRateLimit(officeId, 'CONSULTA')
    if (rateLimitResult) {
      return NextResponse.json(
        { success: false, error: rateLimitResult.message },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rateLimitResult.retryAfterMs || 60000) / 1000)) } }
      )
    }

    // Generate preview
    const config: SpedGeneratorConfig = {
      officeId,
      competencia,
    }

    const result = await generateSpedFiscalPreview(config)

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Erro ao gerar preview do SPED Fiscal',
          details: result.errors?.join('; '),
        },
        { status: 500 }
      )
    }

    // Create audit log
    await createAuditLog({
      action: 'SPED_FISCAL_PREVIEW',
      entity: 'SpedRegistro',
      details: JSON.stringify({
        competencia,
        totalNfeEntrada: result.resumo?.totalNfeEntrada,
        totalNfeSaida: result.resumo?.totalNfeSaida,
        totalNfse: result.resumo?.totalNfse,
        totalParticipantes: result.resumo?.totalParticipantes,
        totalItens: result.resumo?.totalItens,
        totalInventario: result.resumo?.totalInventario,
      }),
      userId: auth.payload.userId,
      officeId,
    })

    return NextResponse.json({
      success: true,
      data: result.resumo,
    })
  } catch (error) {
    logger.error('Erro ao gerar preview do SPED Fiscal:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao gerar preview do SPED Fiscal',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    )
  }
}
