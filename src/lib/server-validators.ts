// KiteOS - Server-side validations for Brazilian documents
// Used in API routes to validate CPF, CNPJ, NCM, CFOP

/** Remove non-digits */
function digits(value: string): string {
  return value.replace(/\D/g, '')
}

/** Validate CPF check digits */
export function isValidCPF(cpf: string): boolean {
  const d = digits(cpf)
  if (d.length !== 11) return false
  if (/^(\d)\1{10}$/.test(d)) return false

  let sum = 0
  for (let i = 0; i < 9; i++) sum += parseInt(d[i]) * (10 - i)
  let rem = (sum * 10) % 11
  if (rem === 10) rem = 0
  if (rem !== parseInt(d[9])) return false

  sum = 0
  for (let i = 0; i < 10; i++) sum += parseInt(d[i]) * (11 - i)
  rem = (sum * 10) % 11
  if (rem === 10) rem = 0
  if (rem !== parseInt(d[10])) return false

  return true
}

/** Validate CNPJ check digits */
export function isValidCNPJ(cnpj: string): boolean {
  const d = digits(cnpj)
  if (d.length !== 14) return false
  if (/^(\d)\1{13}$/.test(d)) return false

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]

  let sum = 0
  for (let i = 0; i < 12; i++) sum += parseInt(d[i]) * w1[i]
  let rem = sum % 11
  const dv1 = rem < 2 ? 0 : 11 - rem
  if (dv1 !== parseInt(d[12])) return false

  sum = 0
  for (let i = 0; i < 13; i++) sum += parseInt(d[i]) * w2[i]
  rem = sum % 11
  const dv2 = rem < 2 ? 0 : 11 - rem
  if (dv2 !== parseInt(d[13])) return false

  return true
}

/** Validate CPF or CNPJ based on length */
export function isValidCPFCNPJ(value: string): boolean {
  const d = digits(value)
  if (!d) return true // optional field
  if (d.length <= 11) return isValidCPF(d)
  return isValidCNPJ(d)
}

/** Validate NCM: exactly 8 digits */
export function isValidNCM(ncm: string): boolean {
  const d = digits(ncm)
  if (!d) return true // optional
  if (d.length !== 8) return false
  const chapter = parseInt(d.slice(0, 2))
  return chapter >= 1 && chapter <= 99
}

/** Validate CFOP: exactly 4 digits, starts with 1-7 */
export function isValidCFOP(cfop: string): boolean {
  const d = digits(cfop)
  if (!d) return true // optional
  if (d.length !== 4) return false
  const first = parseInt(d[0])
  return first >= 1 && first <= 7
}
