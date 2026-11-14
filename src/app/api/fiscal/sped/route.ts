import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { applyRateLimit } from '@/lib/sefaz/rate-limiter'
import { generateSpedFiscal, type SpedGeneratorConfig } from '@/lib/sped'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { officeId, competencia, versao, contabilista } = body

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

    // Delete existing SPED registros for this period (allow re-generation)
    const deletedCount = await db.spedRegistro.deleteMany({
      where: {
        officeId,
        periodo: competencia,
      },
    })

    if (deletedCount.count > 0) {
      await createAuditLog({
        action: 'SPED_FISCAL_REPLACED',
        entity: 'SpedRegistro',
        details: JSON.stringify({
          competencia,
          registrosDeletados: deletedCount.count,
        }),
        userId: auth.payload.userId,
        officeId,
      })
    }

    // Generate SPED Fiscal
    // FISC-03: os dados do contabilista (registro 0100) são entrada obrigatória.
    // Sem eles o gerador recusa em vez de inventar nome e CRC.
    const config: SpedGeneratorConfig = {
      officeId,
      competencia,
      versao: versao || '019',
      contabilista: contabilista ?? null,
    }

    const result = await generateSpedFiscal(config)

    if (!result.success) {
      // 400 quando o que falta é entrada do chamador (contabilista, competência),
      // 500 só para falha inesperada da geração.
      const isInputError = (result.errors ?? []).some(e => e.startsWith('Registro 0100'))
      return NextResponse.json(
        {
          success: false,
          error: isInputError
            ? 'Dados do contabilista ausentes ou inválidos — o SPED não é gerado com o registro 0100 fictício'
            : 'Erro ao gerar arquivo SPED Fiscal',
          details: result.errors?.join('; '),
        },
        { status: isInputError ? 400 : 500 }
      )
    }

    // Parse the generated content and save individual records to SpedRegistro for audit
    const linhas = result.conteudo.split('\n')
    const spedRegistrosData = linhas.map((linha, index) => {
      // Extract registro name from line: |REGISTRO|...|
      const fields = linha.split('|')
      const registro = fields[1] || ''
      // Determine block from registro
      let bloco = ''
      if (registro === '0000' || registro === '0001' || registro === '0005' || registro === '0100' || registro.startsWith('0150') || registro.startsWith('0190') || registro.startsWith('0200') || registro === '0990') {
        bloco = '0'
      } else if (registro.startsWith('C')) {
        bloco = 'C'
      } else if (registro.startsWith('D')) {
        bloco = 'D'
      } else if (registro.startsWith('E')) {
        bloco = 'E'
      } else if (registro.startsWith('H')) {
        bloco = 'H'
      } else if (registro.startsWith('1')) {
        bloco = '1'
      } else if (registro.startsWith('9')) {
        bloco = '9'
      }

      return {
        periodo: competencia,
        bloco,
        registro,
        linha,
        ordem: index,
        officeId,
      }
    })

    // Batch insert sped registros (in chunks to avoid SQLite limits)
    const CHUNK_SIZE = 100
    for (let i = 0; i < spedRegistrosData.length; i += CHUNK_SIZE) {
      const chunk = spedRegistrosData.slice(i, i + CHUNK_SIZE)
      await db.spedRegistro.createMany({
        data: chunk,
      })
    }

    // Create audit log
    await createAuditLog({
      action: 'SPED_FISCAL_GERAR',
      entity: 'SpedRegistro',
      details: JSON.stringify({
        competencia,
        versao: config.versao,
        totalLinhas: result.totalLinhas,
        totalRegistros: result.totalRegistros,
      }),
      userId: auth.payload.userId,
      officeId,
    })

    return NextResponse.json({
      success: true,
      data: {
        competencia,
        versao: config.versao,
        conteudo: result.conteudo,
        totalLinhas: result.totalLinhas,
        totalRegistros: result.totalRegistros,
      },
    })
  } catch (error) {
    logger.error('Erro ao gerar SPED Fiscal:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao gerar arquivo SPED Fiscal',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    )
  }
}
