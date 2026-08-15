import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

interface PlacaResult {
  placa: string
  chassi: string
  brand: string
  model: string
  year: number | null
  color: string
  fuel: string
  city: string
  state: string
  renavam: string
  category?: string
  species?: string
  type?: string
  fipeCode?: string
  provider?: string
}

const numToChar = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
const charToNum: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9 }

/**
 * Convert Mercosul plate to traditional format (e.g., ABC1D23 -> ABC1323)
 */
function toTraditionalPlate(placa: string): string {
  if (/^[A-Z]{3}[0-9][A-J][0-9]{2}$/.test(placa)) {
    const letter = placa[4]
    return placa.slice(0, 4) + charToNum[letter] + placa.slice(5)
  }
  return placa
}

/**
 * Convert traditional plate to Mercosul format (e.g., ABC1323 -> ABC1D23)
 */
function toMercosulPlate(placa: string): string {
  if (/^[A-Z]{3}[0-9]{4}$/.test(placa)) {
    const num = parseInt(placa[4], 10)
    return placa.slice(0, 4) + numToChar[num] + placa.slice(5)
  }
  return placa
}

/**
 * Clean up brand/model string
 */
function cleanBrandModel(str: string): { brand: string; model: string } {
  if (!str) return { brand: '', model: '' }
  const parts = str.split('/')
  if (parts.length >= 2) {
    return { brand: parts[0].trim().toUpperCase(), model: parts.slice(1).join('/').trim().toUpperCase() }
  }
  const spaceParts = str.split(' ')
  if (spaceParts.length >= 2) {
    return { brand: spaceParts[0].trim().toUpperCase(), model: spaceParts.slice(1).join(' ').trim().toUpperCase() }
  }
  return { brand: str.trim().toUpperCase(), model: str.trim().toUpperCase() }
}

/**
 * Provider 1: BrasilAPI
 */
async function fetchBrasilAPIPlaca(placa: string): Promise<PlacaResult | null> {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/placa/v1/${placa}`, {
      headers: { 'User-Agent': 'KiteOS/1.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.marca && !data.modelo) return null

    return {
      placa: data.placa || placa,
      chassi: data.chassi || '',
      brand: (data.marca || '').toUpperCase(),
      model: (data.modelo || '').toUpperCase(),
      year: data.ano ? parseInt(String(data.ano), 10) : (data.anoModelo ? parseInt(String(data.anoModelo), 10) : null),
      color: (data.cor || '').toUpperCase(),
      fuel: (data.combustivel || '').toUpperCase(),
      city: (data.municipio || '').toUpperCase(),
      state: (data.uf || '').toUpperCase(),
      renavam: data.renavam || '',
      category: data.categoria || '',
      species: data.especie || '',
      type: data.tipo || '',
      provider: 'BrasilAPI',
    }
  } catch {
    return null
  }
}

/**
 * Provider 2: ApiCarros
 */
async function fetchApiCarrosPlaca(placa: string): Promise<PlacaResult | null> {
  try {
    const res = await fetch(`https://apicarros.com/v1/consulta/${placa}/json`, {
      headers: { 'User-Agent': 'KiteOS/1.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.marca && !data.modelo) return null

    const { brand, model } = cleanBrandModel(data.marca || data.modelo || '')

    return {
      placa: data.placa || placa,
      chassi: data.chassi || '',
      brand: brand || (data.marca || '').toUpperCase(),
      model: data.modelo ? data.modelo.toUpperCase() : model,
      year: data.anoModelo ? parseInt(String(data.anoModelo), 10) : (data.ano ? parseInt(String(data.ano), 10) : null),
      color: (data.cor || '').toUpperCase(),
      fuel: (data.combustivel || '').toUpperCase(),
      city: (data.municipio || '').toUpperCase(),
      state: (data.uf || '').toUpperCase(),
      renavam: data.renavam || '',
      provider: 'ApiCarros',
    }
  } catch {
    return null
  }
}

/**
 * Provider 3: WdApi
 */
async function fetchWdApiPlaca(placa: string): Promise<PlacaResult | null> {
  try {
    const res = await fetch(`https://wdapi2.com.br/consulta/${placa}/free`, {
      headers: { 'User-Agent': 'KiteOS/1.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.marca && !data.modelo) return null

    return {
      placa: data.placa || placa,
      chassi: data.chassi || '',
      brand: (data.marca || '').toUpperCase(),
      model: (data.modelo || '').toUpperCase(),
      year: data.anoModelo ? parseInt(String(data.anoModelo), 10) : (data.ano ? parseInt(String(data.ano), 10) : null),
      color: (data.cor || '').toUpperCase(),
      fuel: (data.combustivel || '').toUpperCase(),
      city: (data.municipio || '').toUpperCase(),
      state: (data.uf || '').toUpperCase(),
      renavam: data.renavam || '',
      provider: 'WdApi',
    }
  } catch {
    return null
  }
}

/**
 * Helper to query all providers for a target plate format
 */
async function queryProvidersForPlaca(placaTarget: string): Promise<PlacaResult | null> {
  let result = await fetchBrasilAPIPlaca(placaTarget)
  if (!result) {
    result = await fetchApiCarrosPlaca(placaTarget)
  }
  if (!result) {
    result = await fetchWdApiPlaca(placaTarget)
  }
  return result
}

/**
 * GET /api/consulta/placa?placa=ABC1D23
 * Consulta dados de veículo pela placa com suporte a formato Mercosul/Tradicional
 * e fallback automático entre múltiplos provedores.
 * Requer autenticação.
 */
export async function GET(request: NextRequest) {
  try {
    // Verify auth
    const auth = await requireAuth(request)
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status })
    }

    const { searchParams } = new URL(request.url)
    const rawPlaca = searchParams.get('placa')?.toUpperCase().replace(/[^A-Z0-9]/g, '')

    if (!rawPlaca || (rawPlaca.length !== 7 && rawPlaca.length !== 8)) {
      return NextResponse.json(
        { success: false, error: 'Placa inválida. Use o formato ABC1D23 ou ABC-1234.' },
        { status: 400 }
      )
    }

    // Try primary input plate format
    let result = await queryProvidersForPlaca(rawPlaca)

    // If primary format fails, try alternative Mercosul / Traditional representation
    if (!result) {
      const altPlaca = toMercosulPlate(rawPlaca) !== rawPlaca
        ? toMercosulPlate(rawPlaca)
        : toTraditionalPlate(rawPlaca)

      if (altPlaca && altPlaca !== rawPlaca) {
        result = await queryProvidersForPlaca(altPlaca)
      }
    }

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'Placa não encontrada na base de dados de veículos. Verifique o número digitado.' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error: unknown) {
    logger.error('Placa lookup error:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { success: false, error: 'Erro ao consultar placa. Tente novamente.' },
      { status: 500 }
    )
  }
}
