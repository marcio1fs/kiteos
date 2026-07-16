import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { consultaStatusServico, type Ambiente } from '@/lib/sefaz'
import { applyRateLimit } from '@/lib/sefaz/rate-limiter'

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const officeId = searchParams.get('officeId')

    if (!officeId) {
      return NextResponse.json(
        { success: false, errors: ['officeId é obrigatório'] },
        { status: 400 }
      )
    }

    const auth = await requireAuth(request, officeId)
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status })
    }

    // Rate limiting
    const rateLimitResult = applyRateLimit(officeId, 'STATUS')
    if (rateLimitResult) {
      return NextResponse.json(
        { success: false, errors: [rateLimitResult.message] },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rateLimitResult.retryAfterMs || 60000) / 1000)) } }
      )
    }

    // Get active certificate
    const cert = await db.certificadoDigital.findFirst({
      where: { officeId, ativo: true, deleted: false },
    })

    if (!cert) {
      return NextResponse.json(
        { success: false, errors: ['Certificado digital não configurado'] },
        { status: 400 }
      )
    }

    const result = await consultaStatusServico({
      ambiente: cert.ambiente as Ambiente,
      uf: cert.uf,
      cnpjCpf: cert.cnpjCpf || '',
    })

    return NextResponse.json({
      success: result.success,
      data: {
        cStat: result.cStat,
        xMotivo: result.xMotivo,
        tMed: result.tMed,
      },
    })
  } catch (error) {
    console.error('Error checking SEFAZ status:', error)
    return NextResponse.json(
      { success: false, errors: ['Erro ao verificar status SEFAZ'] },
      { status: 500 }
    )
  }
}
