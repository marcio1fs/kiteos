import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { logger } from '@/lib/logger'

interface CnpjResult {
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  atividadePrincipal: string
  email: string
  telefone: string
  address: string
  bairro?: string
  city: string
  state: string
  zipCode: string
  ie: string
  situacao: string
  dataAbertura: string
  capitalSocial: number
  provider?: string
}

/**
 * Format phone string to (XX) XXXXX-XXXX or (XX) XXXX-XXXX
 */
function formatPhoneDigits(digits: string): string {
  const clean = digits.replace(/\D/g, '')
  if (clean.length === 11) {
    return clean.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  }
  if (clean.length === 10) {
    return clean.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  }
  return digits
}

/**
 * Format CEP string to XXXXX-XXX
 */
function formatCepDigits(cep: string): string {
  const clean = cep.replace(/\D/g, '')
  if (clean.length === 8) {
    return clean.replace(/^(\d{5})(\d{3})$/, '$1-$2')
  }
  return cep
}

/**
 * Provider 1: BrasilAPI
 */
async function fetchBrasilAPI(cnpj: string): Promise<CnpjResult | null> {
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { 'User-Agent': 'KiteOS/1.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.razao_social && !data.nome_fantasia) return null

    const street = [data.tipo_logradouro, data.logradouro].filter(Boolean).join(' ')
    const numberStr = data.numero ? `, ${data.numero}` : ''
    const compStr = data.complemento ? ` - ${data.complemento}` : ''
    const fullAddress = street ? `${street}${numberStr}${compStr}`.trim() : ''

    return {
      cnpj: data.cnpj || cnpj,
      razaoSocial: data.razao_social || data.nome_fantasia || '',
      nomeFantasia: data.nome_fantasia || data.razao_social || '',
      atividadePrincipal: data.cnae_fiscal_descricao || '',
      email: (data.email || '').toLowerCase().trim(),
      telefone: data.ddd_telefone_1 ? formatPhoneDigits(data.ddd_telefone_1) : '',
      address: fullAddress,
      bairro: data.bairro || '',
      city: data.municipio || '',
      state: (data.uf || '').toUpperCase(),
      zipCode: data.cep ? formatCepDigits(data.cep) : '',
      ie: data.inscricao_estadual || '',
      situacao: data.descricao_situacao_cadastral || 'ATIVA',
      dataAbertura: data.data_inicio_atividade || '',
      capitalSocial: typeof data.capital_social === 'number' ? data.capital_social : parseFloat(data.capital_social || '0'),
      provider: 'BrasilAPI',
    }
  } catch {
    return null
  }
}

/**
 * Provider 2: Minha Receita
 */
async function fetchMinhaReceita(cnpj: string): Promise<CnpjResult | null> {
  try {
    const res = await fetch(`https://minhareceita.org/${cnpj}`, {
      headers: { 'User-Agent': 'KiteOS/1.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.razao_social && !data.nome_fantasia) return null

    const street = [data.descricao_tipo_de_logradouro, data.logradouro].filter(Boolean).join(' ')
    const numberStr = data.numero ? `, ${data.numero}` : ''
    const compStr = data.complemento ? ` - ${data.complemento}` : ''
    const fullAddress = street ? `${street}${numberStr}${compStr}`.trim() : ''

    return {
      cnpj: data.cnpj || cnpj,
      razaoSocial: data.razao_social || data.nome_fantasia || '',
      nomeFantasia: data.nome_fantasia || data.razao_social || '',
      atividadePrincipal: data.cnae_fiscal_descricao || '',
      email: (data.email || '').toLowerCase().trim(),
      telefone: data.ddd_telefone_1 ? formatPhoneDigits(data.ddd_telefone_1) : '',
      address: fullAddress,
      bairro: data.bairro || '',
      city: data.municipio || '',
      state: (data.uf || '').toUpperCase(),
      zipCode: data.cep ? formatCepDigits(data.cep) : '',
      ie: '',
      situacao: data.descricao_situacao_cadastral || 'ATIVA',
      dataAbertura: data.data_inicio_atividade || '',
      capitalSocial: typeof data.capital_social === 'number' ? data.capital_social : parseFloat(data.capital_social || '0'),
      provider: 'MinhaReceita',
    }
  } catch {
    return null
  }
}

/**
 * Provider 3: CNPJ.ws (Publica)
 */
async function fetchCnpjWs(cnpj: string): Promise<CnpjResult | null> {
  try {
    const res = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, {
      headers: { 'User-Agent': 'KiteOS/1.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data = await res.json()
    const est = data.estabelecimento
    if (!data.razao_social && !est?.nome_fantasia) return null

    const street = [est?.tipo_logradouro, est?.logradouro].filter(Boolean).join(' ')
    const numberStr = est?.numero ? `, ${est.numero}` : ''
    const compStr = est?.complemento ? ` - ${est.complemento}` : ''
    const fullAddress = street ? `${street}${numberStr}${compStr}`.trim() : ''

    const phone1 = est?.ddd1 && est?.telefone1 ? `${est.ddd1}${est.telefone1}` : ''
    const ieObj = est?.inscrições_estaduais?.[0]

    return {
      cnpj,
      razaoSocial: data.razao_social || est?.nome_fantasia || '',
      nomeFantasia: est?.nome_fantasia || data.razao_social || '',
      atividadePrincipal: est?.atividade_principal?.descricao || '',
      email: (est?.email || '').toLowerCase().trim(),
      telefone: phone1 ? formatPhoneDigits(phone1) : '',
      address: fullAddress,
      bairro: est?.bairro || '',
      city: est?.cidade?.nome || '',
      state: (est?.estado?.sigla || '').toUpperCase(),
      zipCode: est?.cep ? formatCepDigits(est.cep) : '',
      ie: ieObj?.inscricao_estadual || '',
      situacao: est?.situacao_cadastral || 'ATIVA',
      dataAbertura: est?.data_inicio_atividade || '',
      capitalSocial: typeof data.capital_social === 'number' ? data.capital_social : parseFloat(data.capital_social || '0'),
      provider: 'CNPJ.ws',
    }
  } catch {
    return null
  }
}

/**
 * Provider 4: ReceitaWS
 */
async function fetchReceitaWS(cnpj: string): Promise<CnpjResult | null> {
  try {
    const res = await fetch(`https://receitaws.com.br/v1/cnpj/${cnpj}`, {
      headers: { 'User-Agent': 'KiteOS/1.0' },
      signal: AbortSignal.timeout(6000),
    })
    if (!res.ok) return null
    const data = await res.json()
    if (data.status === 'ERROR' || (!data.nome && !data.fantasia)) return null

    const street = data.logradouro || ''
    const numberStr = data.numero ? `, ${data.numero}` : ''
    const compStr = data.complemento ? ` - ${data.complemento}` : ''
    const fullAddress = street ? `${street}${numberStr}${compStr}`.trim() : ''

    return {
      cnpj,
      razaoSocial: data.nome || data.fantasia || '',
      nomeFantasia: data.fantasia || data.nome || '',
      atividadePrincipal: data.atividade_principal?.[0]?.text || '',
      email: (data.email || '').toLowerCase().trim(),
      telefone: data.telefone ? formatPhoneDigits(data.telefone.split('/')[0].trim()) : '',
      address: fullAddress,
      bairro: data.bairro || '',
      city: data.municipio || '',
      state: (data.uf || '').toUpperCase(),
      zipCode: data.cep ? formatCepDigits(data.cep) : '',
      ie: '',
      situacao: data.situacao || 'ATIVA',
      dataAbertura: data.abertura || '',
      capitalSocial: parseFloat(data.capital_social || '0'),
      provider: 'ReceitaWS',
    }
  } catch {
    return null
  }
}

/**
 * GET /api/consulta/cnpj?cnpj=00000000000191
 * Consulta dados de CNPJ com fallback automático entre múltiplos provedores (BrasilAPI, MinhaReceita, CNPJ.ws, ReceitaWS).
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
    const cnpj = searchParams.get('cnpj')?.replace(/\D/g, '')

    if (!cnpj || cnpj.length !== 14) {
      return NextResponse.json(
        { success: false, error: 'CNPJ inválido. Deve conter 14 dígitos.' },
        { status: 400 }
      )
    }

    // Pipeline de provedores com fallback automático
    let result = await fetchBrasilAPI(cnpj)
    if (!result) {
      result = await fetchMinhaReceita(cnpj)
    }
    if (!result) {
      result = await fetchCnpjWs(cnpj)
    }
    if (!result) {
      result = await fetchReceitaWS(cnpj)
    }

    if (!result) {
      return NextResponse.json(
        { success: false, error: 'CNPJ não encontrado na base de dados da Receita Federal. Verifique o número digitado.' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error: unknown) {
    logger.error('CNPJ lookup error:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json(
      { success: false, error: 'Erro ao consultar CNPJ. Tente novamente.' },
      { status: 500 }
    )
  }
}
