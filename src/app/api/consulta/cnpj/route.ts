import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'

/**
 * GET /api/consulta/cnpj?cnpj=00000000000191
 * Consulta dados de CNPJ na BrasilAPI e retorna dados formatados.
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
    const cnpj = searchParams.get('cnpj')?.replace(/\D/g, '')

    if (!cnpj || cnpj.length !== 14) {
      return NextResponse.json(
        { success: false, error: 'CNPJ inválido. Deve conter 14 dígitos.' },
        { status: 400 }
      )
    }

    // Query BrasilAPI
    const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
      headers: { 'User-Agent': 'KiteOS/1.0' },
      signal: AbortSignal.timeout(10000), // 10s timeout
    })

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { success: false, error: 'CNPJ não encontrado na base da Receita. Verifique se o CNPJ está correto ou preencha os dados manualmente.' }
        )
      }
      return NextResponse.json(
        { success: false, error: 'Erro ao consultar CNPJ. Tente novamente.' },
        { status: 502 }
      )
    }

    const data = await response.json()

    // Map BrasilAPI response to our format
    const result = {
      cnpj: data.cnpj,
      razaoSocial: data.razao_social || '',
      nomeFantasia: data.nome_fantasia || '',
      atividadePrincipal: data.cnae_fiscal_descricao || '',
      email: data.email || '',
      telefone: data.ddd_telefone_1 || '',
      address: data.logradouro
        ? `${data.tipo_logradouro || ''} ${data.logradouro}${data.numero ? ', ' + data.numero : ''}${data.complemento ? ' - ' + data.complemento : ''}`.trim()
        : '',
      city: data.municipio || '',
      state: data.uf || '',
      zipCode: data.cep ? data.cep.replace(/^(\d{5})(\d{3})$/, '$1-$2') : '',
      ie: data.inscricao_estadual || '',
      situacao: data.descricao_situacao_cadastral || '',
      dataAbertura: data.data_inicio_atividade || '',
      capitalSocial: data.capital_social || 0,
    }

    return NextResponse.json({ success: true, data: result })
  } catch (error: unknown) {
    console.error('CNPJ lookup error:', error)
    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json(
        { success: false, error: 'Tempo esgotado ao consultar CNPJ. Tente novamente.' },
        { status: 504 }
      )
    }
    return NextResponse.json(
      { success: false, error: 'Erro interno ao consultar CNPJ.' },
      { status: 500 }
    )
  }
}
