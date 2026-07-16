// KiteOS - Validações e Máscaras conforme legislação brasileira
// CPF: 11 dígitos | CNPJ: 14 dígitos | NCM: 8 dígitos | CFOP: 4 dígitos | IE: até 14 dígitos

// =============================================
// MÁSCARAS (aplicadas durante digitação)
// =============================================

/** Máscara CPF: 000.000.000-00 */
export function maskCPF(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 3) return digits
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
}

/** Máscara CNPJ: 00.000.000/0000-00 */
export function maskCNPJ(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 14)
  if (digits.length <= 2) return digits
  if (digits.length <= 5) return `${digits.slice(0, 2)}.${digits.slice(2)}`
  if (digits.length <= 8) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5)}`
  if (digits.length <= 12) return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8)}`
  return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`
}

/** Máscara CPF ou CNPJ (detecta automaticamente pelo tamanho) */
export function maskCPFCNPJ(value: string): string {
  const digits = value.replace(/\D/g, '')
  // Se tem mais de 11 dígitos, trata como CNPJ
  if (digits.length > 11) return maskCNPJ(value)
  return maskCPF(value)
}

/** Máscara NCM: 0000.00.00 */
export function maskNCM(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 4) return digits
  if (digits.length <= 6) return `${digits.slice(0, 4)}.${digits.slice(4)}`
  return `${digits.slice(0, 4)}.${digits.slice(4, 6)}.${digits.slice(6)}`
}

/** Máscara CFOP: apenas 4 dígitos numéricos */
export function maskCFOP(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4)
}

/** Máscara Inscrição Estadual: apenas números, até 14 dígitos */
export function maskIE(value: string): string {
  return value.replace(/\D/g, '').slice(0, 14)
}

/** Máscara CEP: 00000-000 */
export function maskCEP(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 5) return digits
  return `${digits.slice(0, 5)}-${digits.slice(5)}`
}

/** Máscara Telefone: (00) 00000-0000 ou (00) 0000-0000 */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return digits.length ? `(${digits}` : ''
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

// =============================================
// VALIDAÇÕES (retornam mensagem de erro ou null)
// =============================================

/** Valida dígitos verificadores do CPF */
export function validateCPF(cpf: string): string | null {
  const digits = cpf.replace(/\D/g, '')
  if (!digits) return null // Campo opcional
  if (digits.length !== 11) return 'CPF deve ter 11 dígitos'
  if (/^(\d)\1{10}$/.test(digits)) return 'CPF inválido (todos dígitos iguais)'

  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i)
  let remainder = (sum * 10) % 11
  if (remainder === 10) remainder = 0
  if (remainder !== parseInt(digits[9])) return 'CPF inválido'

  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i)
  remainder = (sum * 10) % 11
  if (remainder === 10) remainder = 0
  if (remainder !== parseInt(digits[10])) return 'CPF inválido'

  return null
}

/** Valida dígitos verificadores do CNPJ */
export function validateCNPJ(cnpj: string): string | null {
  const digits = cnpj.replace(/\D/g, '')
  if (!digits) return null // Campo opcional
  if (digits.length !== 14) return 'CNPJ deve ter 14 dígitos'
  if (/^(\d)\1{13}$/.test(digits)) return 'CNPJ inválido (todos dígitos iguais)'

  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

  let sum = 0
  for (let i = 0; i < 12; i++) sum += parseInt(digits[i]) * weights1[i]
  let remainder = sum % 11
  const dv1 = remainder < 2 ? 0 : 11 - remainder
  if (dv1 !== parseInt(digits[12])) return 'CNPJ inválido'

  sum = 0
  for (let i = 0; i < 13; i++) sum += parseInt(digits[i]) * weights2[i]
  remainder = sum % 11
  const dv2 = remainder < 2 ? 0 : 11 - remainder
  if (dv2 !== parseInt(digits[13])) return 'CNPJ inválido'

  return null
}

/** Valida CPF ou CNPJ (detecta pelo tamanho) */
export function validateCPFCNPJ(value: string): string | null {
  const digits = value.replace(/\D/g, '')
  if (!digits) return null
  if (digits.length <= 11) return validateCPF(digits)
  return validateCNPJ(digits)
}

/** Valida NCM: exatamente 8 dígitos */
export function validateNCM(ncm: string): string | null {
  const digits = ncm.replace(/\D/g, '')
  if (!digits) return null // Campo opcional
  if (digits.length !== 8) return 'NCM deve ter 8 dígitos'
  // NCM começa com capítulo (01-99)
  const chapter = parseInt(digits.slice(0, 2))
  if (chapter < 1 || chapter > 99) return 'NCM com capítulo inválido'
  return null
}

/** Valida CFOP: exatamente 4 dígitos, primeiro dígito 1-7 */
export function validateCFOP(cfop: string): string | null {
  const digits = cfop.replace(/\D/g, '')
  if (!digits) return null // Campo opcional
  if (digits.length !== 4) return 'CFOP deve ter 4 dígitos'
  const firstDigit = parseInt(digits[0])
  if (firstDigit < 1 || firstDigit > 7) return 'CFOP deve começar com 1 a 7'
  return null
}

/** Valida Inscrição Estadual (formato básico) */
export function validateIE(ie: string): string | null {
  const digits = ie.replace(/\D/g, '')
  if (!digits) return null
  if (digits.length < 2 || digits.length > 14) return 'IE deve ter entre 2 e 14 dígitos'
  return null
}

// =============================================
// FORMATAÇÃO PARA EXIBIÇÃO (recebe digits limpos do DB)
// =============================================

/** Formata CPF para exibição: 000.000.000-00 */
export function formatCPF(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 11) return value
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

/** Formata CNPJ para exibição: 00.000.000/0000-00 */
export function formatCNPJ(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length !== 14) return value
  return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
}

/** Formata CPF ou CNPJ para exibição (detecta automaticamente) */
export function formatCPFCNPJ(value: string): string {
  const digits = value.replace(/\D/g, '')
  if (digits.length <= 11) return formatCPF(digits)
  return formatCNPJ(digits)
}

// =============================================
// HELPERS
// =============================================

/** Remove máscara, retornando apenas dígitos */
export function onlyDigits(value: string): string {
  return value.replace(/\D/g, '')
}
