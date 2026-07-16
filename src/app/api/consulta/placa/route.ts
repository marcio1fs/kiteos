import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * GET /api/consulta/placa?placa=ABC1D23
 * Consulta dados de veículo pela placa na BrasilAPI.
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
    const placa = searchParams.get('placa')?.toUpperCase().replace(/[^A-Z0-9]/g, '')

    if (!placa || (placa.length !== 7 && placa.length !== 8)) {
      return NextResponse.json(
        { success: false, error: 'Placa inválida. Use formato ABC1D23 ou ABC-1234.' },
        { status: 400 }
      )
    }

    // Query BrasilAPI
    const response = await fetch(`https://brasilapi.com.br/api/placa/v1/${placa}`, {
      headers: { 'User-Agent': 'KiteOS/1.0' },
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) {
      if (response.status === 404) {
        // Return 200 with success:false so frontend treats it as "not found" not as a route error
        return NextResponse.json(
          { success: false, error: 'Placa não encontrada na base de dados da BrasilAPI. Verifique se a placa está correta ou preencha os dados manualmente.' }
        )
      }
      return NextResponse.json(
        { success: false, error: 'Erro ao consultar placa. Tente novamente.' },
        { status: 502 }
      )
    }

    const data = await response.json()

    // Map BrasilAPI response to our format
    const result = {
      placa: data.placa || placa,
      chassi: data.chassi || '',
      brand: data.marca || '',
      model: data.modelo || '',
      year: data.ano || null,
      color: data.cor || '',
      fuel: data.combustivel || '',
      city: data.municipio || '',
      state: data.uf || '',
      renavam: data.renavam || '',
      category: data.categoria || '',
      species: data.especie || '',
      type: data.tipo || '',
      passengerCapacity: data.capacidade_carga || '',
      power: data.potencia || '',
      cylinder: data.cilindradas || '',
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error: unknown) {
    console.error('Placa lookup error:', error)
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json(
        { success: false, error: 'Tempo esgotado ao consultar placa. Tente novamente.' },
        { status: 504 }
      )
    }
    return NextResponse.json(
      { success: false, error: 'Erro interno ao consultar placa.' },
      { status: 500 }
    )
  }
}
