/**
 * POST /api/sefaz/importar-async
 * Inicia importação assíncrona de NF-e via SEFAZ
 * Retorna imediatamente com o ID do job para acompanhamento
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { validateChave } from '@/lib/nfe/xml-parser'
import { applyRateLimit } from '@/lib/sefaz/rate-limiter'
import { createImportJob, startAsyncProcessing } from '@/lib/sefaz/import-queue'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { chave, officeId } = body

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      )
    }

    const auth = await requireAuth(request, officeId)
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      )
    }

    // Rate limiting
    const rateLimitResult = applyRateLimit(officeId, 'IMPORTACAO')
    if (rateLimitResult) {
      return NextResponse.json(
        { success: false, error: rateLimitResult.message },
        { status: 429 }
      )
    }

    // Validate chave
    if (!chave || !validateChave(chave)) {
      return NextResponse.json(
        { success: false, error: 'Chave de acesso inválida. Deve conter 44 dígitos numéricos com dígito verificador válido.' },
        { status: 400 }
      )
    }

    // Create job
    const job = createImportJob(chave, officeId, auth.payload.userId)

    // Start async processing
    startAsyncProcessing(job.id)

    return NextResponse.json({
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        message: 'Importação iniciada. Use o jobId para verificar o progresso.',
        statusUrl: `/api/sefaz/importar-async/${job.id}?officeId=${officeId}`,
      },
    }, { status: 202 })

  } catch (error) {
    console.error('Erro ao iniciar importação assíncrona:', error)
    return NextResponse.json(
      { success: false, error: 'Erro interno ao iniciar importação' },
      { status: 500 }
    )
  }
}
