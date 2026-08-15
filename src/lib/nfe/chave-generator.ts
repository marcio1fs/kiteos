/**
 * Gerador de Chave de Acesso da NF-e (44 dígitos) conforme padrão SEFAZ
 * Composição: cUF (2) + AAMM (4) + CNPJ (14) + mod (2) + serie (3) + nNF (9) + tpEmis (1) + cNF (8) + cDV (1)
 */

const UF_CODE_MAP: Record<string, string> = {
  AC: '12', AL: '27', AP: '16', AM: '13', BA: '29', CE: '23', DF: '53', ES: '32',
  GO: '52', MA: '21', MG: '31', MS: '50', MT: '51', PA: '15', PB: '25', PE: '26',
  PI: '22', PR: '41', RJ: '33', RN: '24', RO: '11', RR: '14', RS: '43', SC: '42',
  SE: '28', SP: '35', TO: '17',
}

function calculateChaveDV(base43: string): number {
  const pesos = [2, 3, 4, 5, 6, 7, 8, 9]
  let soma = 0
  let pesoIdx = 0

  for (let i = base43.length - 1; i >= 0; i--) {
    soma += parseInt(base43[i], 10) * pesos[pesoIdx % pesos.length]
    pesoIdx++
  }

  const resto = soma % 11
  return resto <= 1 ? 0 : 11 - resto
}

export function generateChaveAcesso(params: {
  uf?: string | null
  dataEmissao?: Date
  cnpjEmitente: string
  modelo?: string
  serie?: string | number
  numero: string | number
  tipoEmissao?: string
}): string {
  const ufCode = params.uf ? (UF_CODE_MAP[params.uf.toUpperCase().trim()] || '29') : '29'
  const date = params.dataEmissao ? new Date(params.dataEmissao) : new Date()
  const aa = String(date.getFullYear()).substring(2, 4)
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const aamm = `${aa}${mm}`
  const cnpj = (params.cnpjEmitente || '00000000000000').replace(/\D/g, '').padStart(14, '0')
  const mod = (params.modelo || '55').padStart(2, '0')
  const serie = String(params.serie || 1).replace(/\D/g, '').padStart(3, '0')
  const nNF = String(params.numero).replace(/\D/g, '').padStart(9, '0')
  const tpEmis = params.tipoEmissao || '1'
  const cNF = String(Math.floor(10000000 + Math.random() * 90000000))

  const base43 = `${ufCode}${aamm}${cnpj}${mod}${serie}${nNF}${tpEmis}${cNF}`
  const dv = calculateChaveDV(base43)

  return `${base43}${dv}`
}
