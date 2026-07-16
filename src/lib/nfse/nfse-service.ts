/**
 * NFS-e (Nota Fiscal de Serviços Eletrônica) - Business Logic
 *
 * Implements NFS-e generation for mechanic workshop services following
 * Brazilian municipal tax rules (ISSQN based on LC 116/2003).
 * XML generation follows the ABRASF standard for compatibility with
 * most Brazilian cities.
 */

// =============================================
// TYPES
// =============================================

export interface NfseServicoData {
  numero: string
  competencia: string // AAAA-MM
  itemListaServico: string // From LC 116/2003 (e.g., "14.01")
  discriminacao: string
  valorServicos: number
  valorDeducoes: number
  aliqIssqn: number
  tipoTributacao: 'ISSQN' | 'ISENTO' | 'IMUNE' | 'NAO_INCIDENCIA'
  clienteCpfCnpj?: string
  clienteNome?: string
  clienteEndereco?: string
  clienteEmail?: string
  clientId?: string
  serviceOrderId?: string
  saleId?: string
}

export interface IssqnCalculation {
  baseCalculo: number
  valorIssqn: number
  valorPis: number
  valorCofins: number
  valorIr: number
  valorCsll: number
  valorInss: number
  valorTotal: number
}

export interface OfficeData {
  cnpj: string
  name: string
  email: string
  phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
  inscricaoMunicipal?: string
}

// =============================================
// CONSTANTES - Item Lista Serviços para Oficinas
// =============================================

export const SERVICOS_OFICINA = [
  { codigo: '14.01', descricao: 'Serviços de reparação e manutenção de veículos' },
  { codigo: '14.02', descricao: 'Serviços de lanternagem e funilaria' },
  { codigo: '14.03', descricao: 'Serviços de pintura de veículos' },
  { codigo: '14.04', descricao: 'Serviços de lubrificação e lavagem de veículos' },
  { codigo: '14.06', descricao: 'Instalação e montagem de acessórios em veículos' },
] as const

// Alíquota padrão de ISSQN para serviços (5% é a mais comum no Brasil)
export const ALIQ_ISSQN_PADRAO = 5.0

// Threshold para IR (lucro presumido - adiciona IR quando acima)
export const IR_THRESHOLD = 0

// =============================================
// CÁLCULOS DE IMPOSTOS
// =============================================

/**
 * Calculate ISSQN and other federal taxes for NFS-e.
 *
 * Rules:
 * - Base de cálculo = valorServicos - valorDeducoes
 * - ISSQN = baseCalculo * aliqIssqn / 100 (usually 5%)
 * - PIS = valorServicos * 0.65% (regime lucro presumido)
 * - COFINS = valorServicos * 3% (regime lucro presumido)
 * - IR = valorServicos * 4.8% (lucro presumido, when applicable)
 * - CSLL = valorServicos * 1% (lucro presumido)
 * - INSS = 11% sobre valorServicos (parte patronal, regime simplificado)
 * - Valor Total = valorServicos - valorDeducoes
 */
export function calculateIssqn(data: NfseServicoData): IssqnCalculation {
  const baseCalculo = Math.max(0, data.valorServicos - data.valorDeducoes)

  // ISSQN - só calcula se tributação for ISSQN
  const valorIssqn = data.tipoTributacao === 'ISSQN'
    ? Math.round(baseCalculo * (data.aliqIssqn / 100) * 100) / 100
    : 0

  // PIS - 0.65% sobre valor dos serviços (regime lucro presumido)
  const valorPis = Math.round(data.valorServicos * 0.0065 * 100) / 100

  // COFINS - 3% sobre valor dos serviços (regime lucro presumido)
  const valorCofins = Math.round(data.valorServicos * 0.03 * 100) / 100

  // IR - 4.8% sobre valor dos serviços (lucro presumido)
  const valorIr = data.valorServicos > IR_THRESHOLD
    ? Math.round(data.valorServicos * 0.048 * 100) / 100
    : 0

  // CSLL - 1% sobre valor dos serviços
  const valorCsll = Math.round(data.valorServicos * 0.01 * 100) / 100

  // INSS - 11% sobre valor dos serviços (parte patronal, simplificado)
  const valorInss = Math.round(data.valorServicos * 0.11 * 100) / 100

  // Valor total líquido
  const valorTotal = Math.round((data.valorServicos - data.valorDeducoes) * 100) / 100

  return {
    baseCalculo,
    valorIssqn,
    valorPis,
    valorCofins,
    valorIr,
    valorCsll,
    valorInss,
    valorTotal,
  }
}

// =============================================
// VALIDAÇÃO
// =============================================

/**
 * Validate required fields for NFS-e generation.
 * Returns an object with valid flag and array of error messages.
 */
export function validateNfseData(data: Partial<NfseServicoData>): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!data.competencia) {
    errors.push('Competência é obrigatória (formato AAAA-MM)')
  } else if (!/^\d{4}-\d{2}$/.test(data.competencia)) {
    errors.push('Competência inválida. Use o formato AAAA-MM')
  }

  if (!data.itemListaServico) {
    errors.push('Item da lista de serviços é obrigatório')
  } else {
    const codigosValidos = SERVICOS_OFICINA.map(s => s.codigo)
    if (!codigosValidos.includes(data.itemListaServico as typeof codigosValidos[number])) {
      errors.push(`Item de serviço inválido. Códigos válidos: ${codigosValidos.join(', ')}`)
    }
  }

  if (!data.discriminacao || data.discriminacao.trim().length === 0) {
    errors.push('Discriminação do serviço é obrigatória')
  }

  if (data.valorServicos === undefined || data.valorServicos === null) {
    errors.push('Valor dos serviços é obrigatório')
  } else if (data.valorServicos < 0) {
    errors.push('Valor dos serviços não pode ser negativo')
  }

  if (data.valorDeducoes !== undefined && data.valorDeducoes < 0) {
    errors.push('Valor das deduções não pode ser negativo')
  }

  if (data.valorDeducoes !== undefined && data.valorServicos !== undefined && data.valorDeducoes > data.valorServicos) {
    errors.push('Valor das deduções não pode ser maior que o valor dos serviços')
  }

  if (data.aliqIssqn === undefined || data.aliqIssqn === null) {
    errors.push('Alíquota do ISSQN é obrigatória')
  } else if (data.aliqIssqn < 0 || data.aliqIssqn > 100) {
    errors.push('Alíquota do ISSQN deve estar entre 0% e 100%')
  }

  if (!data.tipoTributacao) {
    errors.push('Tipo de tributação é obrigatório')
  } else if (!['ISSQN', 'ISENTO', 'IMUNE', 'NAO_INCIDENCIA'].includes(data.tipoTributacao)) {
    errors.push('Tipo de tributação inválido. Use: ISSQN, ISENTO, IMUNE ou NAO_INCIDENCIA')
  }

  // Cliente é obrigatório para NFS-e
  if (!data.clienteNome && !data.clienteCpfCnpj) {
    errors.push('Dados do cliente são obrigatórios (nome ou CPF/CNPJ)')
  }

  // Validar CPF/CNPJ se informado
  if (data.clienteCpfCnpj) {
    const documento = data.clienteCpfCnpj.replace(/\D/g, '')
    if (documento.length !== 11 && documento.length !== 14) {
      errors.push('CPF/CNPJ do cliente inválido')
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

// =============================================
// GERAÇÃO DE XML (Padrão ABRASF)
// =============================================

/**
 * Generate NFS-e XML in ABRASF standard format.
 * This format is compatible with most Brazilian cities that follow
 * the ABRASF standard for NFS-e web services.
 */
export function generateNfseXml(
  nfse: NfseServicoData & IssqnCalculation & { officeData: OfficeData }
): string {
  const now = new Date()
  const dataEmissao = now.toISOString()
  const codigoVerificacao = generateCodigoVerificacao()

  // Formata CPF/CNPJ
  const clienteDoc = nfse.clienteCpfCnpj
    ? nfse.clienteCpfCnpj.replace(/\D/g, '')
    : ''
  const isCnpj = clienteDoc.length === 14

  // Natureza da operação (1=Tributação no município, 2=Tributação fora, 3=Isenção, 4=Imune, 5=Exigibilidade suspensa)
  let naturezaOperacao = 1
  if (nfse.tipoTributacao === 'ISENTO') naturezaOperacao = 3
  else if (nfse.tipoTributacao === 'IMUNE') naturezaOperacao = 4
  else if (nfse.tipoTributacao === 'NAO_INCIDENCIA') naturezaOperacao = 5

  // Simples Nacional
  const optanteSimplesNacional = 1 // 1=Sim (oficinas geralmente são ME/EPP)
  const incentivoFiscal = 2 // 2=Não

  // Situação tributária PIS/COFINS
  // 01=Operação Tributável, 06=Operação Tributável
  const situacaoTributariaPis = nfse.valorPis > 0 ? '01' : '07' // 07=Isenção
  const situacaoTributariaCofins = nfse.valorCofins > 0 ? '01' : '07'

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CompNfse xmlns="http://www.abrasf.org.br/nfse.xsd">
  <Nfse versao="2.04">
    <InfNfse>
      <Numero>${escapeXml(nfse.numero)}</Numero>
      <CodigoVerificacao>${escapeXml(codigoVerificacao)}</CodigoVerificacao>
      <DataEmissao>${dataEmissao}</DataEmissao>
      <Competencia>${escapeXml(nfse.competencia)}-01</Competencia>
      <NaturezaOperacao>${naturezaOperacao}</NaturezaOperacao>
      <OptanteSimplesNacional>${optanteSimplesNacional}</OptanteSimplesNacional>
      <IncentivadorCultural>${incentivoFiscal}</IncentivadorCultural>
      <RegimeEspecialTributacao>1</RegimeEspecialTributacao>
      <IdentificacaoPrestador>
        <CpfCnpj>
          <Cnpj>${escapeXml(nfse.officeData.cnpj.replace(/\D/g, ''))}</Cnpj>
        </CpfCnpj>
        ${nfse.officeData.inscricaoMunicipal ? `<InscricaoMunicipal>${escapeXml(nfse.officeData.inscricaoMunicipal)}</InscricaoMunicipal>` : ''}
      </IdentificacaoPrestador>
      ${clienteDoc ? `
      <IdentificacaoTomador>
        <CpfCnpj>
          ${isCnpj ? `<Cnpj>${escapeXml(clienteDoc)}</Cnpj>` : `<Cpf>${escapeXml(clienteDoc)}</Cpf>`}
        </CpfCnpj>
      </IdentificacaoTomador>` : ''}
      <Servico>
        <Valores>
          <ValorServicos>${nfse.valorServicos.toFixed(2)}</ValorServicos>
          <ValorDeducoes>${nfse.valorDeducoes.toFixed(2)}</ValorDeducoes>
          <ValorPis>${nfse.valorPis.toFixed(2)}</ValorPis>
          <ValorCofins>${nfse.valorCofins.toFixed(2)}</ValorCofins>
          <ValorInss>${nfse.valorInss.toFixed(2)}</ValorInss>
          <ValorIr>${nfse.valorIr.toFixed(2)}</ValorIr>
          <ValorCsll>${nfse.valorCsll.toFixed(2)}</ValorCsll>
          <IssRetido>2</IssRetido>
          <BaseCalculo>${nfse.baseCalculo.toFixed(2)}</BaseCalculo>
          <Aliquota>${nfse.aliqIssqn.toFixed(4)}</Aliquota>
          <ValorIssqn>${nfse.valorIssqn.toFixed(2)}</ValorIssqn>
        </Valores>
        <ItemListaServico>${escapeXml(nfse.itemListaServico)}</ItemListaServico>
        <Discriminacao>${escapeXml(nfse.discriminacao)}</Discriminacao>
        <CodigoTributacaoMunicipio>${escapeXml(nfse.itemListaServico.replace('.', ''))}</CodigoTributacaoMunicipio>
      </Servico>
      <PrestadorServico>
        <IdentificacaoPrestador>
          <CpfCnpj>
            <Cnpj>${escapeXml(nfse.officeData.cnpj.replace(/\D/g, ''))}</Cnpj>
          </CpfCnpj>
          ${nfse.officeData.inscricaoMunicipal ? `<InscricaoMunicipal>${escapeXml(nfse.officeData.inscricaoMunicipal)}</InscricaoMunicipal>` : ''}
        </IdentificacaoPrestador>
        <RazaoSocial>${escapeXml(nfse.officeData.name)}</RazaoSocial>
        <Endereco>
          ${nfse.officeData.address ? `<Logradouro>${escapeXml(nfse.officeData.address)}</Logradouro>` : ''}
          ${nfse.officeData.city ? `<Municipio>${escapeXml(nfse.officeData.city)}</Municipio>` : ''}
          ${nfse.officeData.state ? `<Uf>${escapeXml(nfse.officeData.state)}</Uf>` : ''}
          ${nfse.officeData.zipCode ? `<Cep>${escapeXml(nfse.officeData.zipCode.replace(/\D/g, ''))}</Cep>` : ''}
        </Endereco>
        ${nfse.officeData.email ? `<Contato><Email>${escapeXml(nfse.officeData.email)}</Email></Contato>` : ''}
        ${nfse.officeData.phone ? `<Contato><Fone>${escapeXml(nfse.officeData.phone.replace(/\D/g, ''))}</Fone></Contato>` : ''}
      </PrestadorServico>
      ${clienteDoc || nfse.clienteNome ? `
      <TomadorServico>
        ${clienteDoc ? `
        <IdentificacaoTomador>
          <CpfCnpj>
            ${isCnpj ? `<Cnpj>${escapeXml(clienteDoc)}</Cnpj>` : `<Cpf>${escapeXml(clienteDoc)}</Cpf>`}
          </CpfCnpj>
        </IdentificacaoTomador>` : ''}
        ${nfse.clienteNome ? `<RazaoSocial>${escapeXml(nfse.clienteNome)}</RazaoSocial>` : ''}
        ${nfse.clienteEndereco ? `
        <Endereco>
          <Logradouro>${escapeXml(nfse.clienteEndereco)}</Logradouro>
        </Endereco>` : ''}
        ${nfse.clienteEmail ? `<Contato><Email>${escapeXml(nfse.clienteEmail)}</Email></Contato>` : ''}
      </TomadorServico>` : ''}
    </InfNfse>
  </Nfse>
</CompNfse>`

  return xml
}

// =============================================
// HELPERS
// =============================================

/**
 * Generate a verification code for NFS-e.
 * Format: 8 alphanumeric characters.
 */
function generateCodigoVerificacao(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

/**
 * Escape special characters for XML content.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Get the current competencia in AAAA-MM format.
 */
export function getCurrentCompetencia(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/**
 * Format currency value for display (Brazilian Real).
 */
export function formatNfseCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

/**
 * Get the description for a service item code.
 */
export function getServicoDescricao(codigo: string): string {
  const servico = SERVICOS_OFICINA.find(s => s.codigo === codigo)
  return servico?.descricao || 'Serviço não identificado'
}
