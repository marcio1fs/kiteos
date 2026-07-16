/**
 * GET /api/sefaz/importar-async/[jobId]
 * Verifica o status de um job de importação assíncrona
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { getImportJob } from '@/lib/sefaz/import-queue'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  try {
    const { jobId } = await params
    const { searchParams } = new URL(request.url)
    const officeId = searchParams.get('officeId')

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

    const job = getImportJob(jobId)

    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Job não encontrado' },
        { status: 404 }
      )
    }

    // Verify job belongs to the office
    if (job.officeId !== officeId) {
      return NextResponse.json(
        { success: false, error: 'Job não pertence a este escritório' },
        { status: 403 }
      )
    }

    return NextResponse.json({
      success: true,
      data: {
        jobId: job.id,
        chave: job.chave,
        status: job.status,
        progress: job.progress,
        result: job.result,
        error: job.error,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
      },
    })

  } catch (error) {
    console.error('Erro ao verificar status do job:', error)
    return NextResponse.json(
      { success: false, error: 'Erro interno ao verificar status' },
      { status: 500 }
    )
  }
}
