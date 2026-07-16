import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * GET /api/consulta/cep?cep=40000000
 * Consulta CEP na BrasilAPI (ViaCEP) e retorna endereço.
 * Requer autenticação.
 * SEC-08 FIX: Migrated from verifyToken+getTokenFromHeaders to requireAuth
 */
export async function GET(request: NextRequest) {
  try {
    // Verify auth
    const auth = await requireAuth(request)
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status })
    }

    const { searchParams } = new URL(request.url)
    const cep = searchParams.get('cep')?.replace(/\D/g, '')

    if (!cep || cep.length !== 8) {
      return NextResponse.json(
        { success: false, error: 'CEP inválido. Deve conter 8 dígitos.' },
        { status: 400 }
      )
    }

    // Query BrasilAPI (ViaCEP)
    const response = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`, {
      headers: { 'User-Agent': 'KiteOS/1.0' },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { success: false, error: 'CEP não encontrado. Verifique se o CEP está correto ou preencha o endereço manualmente.' }
        )
      }
      return NextResponse.json(
        { success: false, error: 'Erro ao consultar CEP. Tente novamente.' },
        { status: 502 }
      )
    }

    const data = await response.json()

    const result = {
      cep: data.cep || '',
      address: data.street || '',
      neighborhood: data.neighborhood || '',
      city: data.city || '',
      state: data.state || '',
      location: data.location || null,
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error: unknown) {
    console.error('CEP lookup error:', error)
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json(
        { success: false, error: 'Tempo esgotado ao consultar CEP. Tente novamente.' },
        { status: 504 }
      )
    }
    return NextResponse.json(
      { success: false, error: 'Erro interno ao consultar CEP.' },
      { status: 500 }
    )
  }
}
