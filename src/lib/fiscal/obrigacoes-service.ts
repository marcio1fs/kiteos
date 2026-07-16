/**
 * Fiscal Obligations Service
 *
 * Generates and manages fiscal obligations for Brazilian mechanic workshops.
 * Extracted from dashboard-service for reuse.
 */

import { db } from '@/lib/db'

export interface ObrigacaoFiscal {
  nome: string
  competencia: string
  dataVencimento: Date
  status: 'PENDENTE' | 'ENTREGUE' | 'ATRASADA'
  tipo: 'SPED_FISCAL' | 'DCTF' | 'GIA' | 'DIRF' | 'DAS' | 'ISSQN'
}

/**
 * Get fiscal obligations for an office.
 * Generates obligations based on the current date and checks
 * which ones have been fulfilled (e.g., SPED already generated).
 */
export async function getObrigacoesFromService(officeId: string): Promise<ObrigacaoFiscal[]> {
  const now = new Date()
  const obrigacoes: ObrigacaoFiscal[] = []

  // SPED Fiscal e DAS e ISSQN dos últimos 6 meses
  for (let i = 1; i <= 6; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const competencia = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}`
    const competenciaDisplay = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

    // SPED é entregue até o dia 20 do mês seguinte
    const dataVencimentoSPED = new Date(date.getFullYear(), date.getMonth() + 1, 20)

    // Verificar se já existe registro SPED para esta competência
    const spedExiste = await db.spedRegistro.findFirst({
      where: { officeId, periodo: competencia },
    })

    let statusSPED: ObrigacaoFiscal['status'] = 'PENDENTE'
    if (spedExiste) {
      statusSPED = 'ENTREGUE'
    } else if (dataVencimentoSPED < now) {
      statusSPED = 'ATRASADA'
    }

    obrigacoes.push({
      nome: 'SPED Fiscal',
      competencia: competenciaDisplay,
      dataVencimento: dataVencimentoSPED,
      status: statusSPED,
      tipo: 'SPED_FISCAL',
    })

    // DAS (Documento de Arrecadação do Simples Nacional) - dia 20
    const dataVencimentoDAS = new Date(date.getFullYear(), date.getMonth() + 1, 20)
    let statusDAS: ObrigacaoFiscal['status'] = 'PENDENTE'
    if (dataVencimentoDAS < now) {
      statusDAS = 'ATRASADA'
    }

    obrigacoes.push({
      nome: 'DAS - Simples Nacional',
      competencia: competenciaDisplay,
      dataVencimento: dataVencimentoDAS,
      status: statusDAS,
      tipo: 'DAS',
    })

    // ISSQN (mensal para prestadores de serviço) - dia 15 do mês seguinte
    const dataVencimentoISSQN = new Date(date.getFullYear(), date.getMonth() + 1, 15)
    let statusISSQN: ObrigacaoFiscal['status'] = 'PENDENTE'
    if (dataVencimentoISSQN < now) {
      statusISSQN = 'ATRASADA'
    }

    obrigacoes.push({
      nome: 'ISSQN Municipal',
      competencia: competenciaDisplay,
      dataVencimento: dataVencimentoISSQN,
      status: statusISSQN,
      tipo: 'ISSQN',
    })
  }

  // GIA (Guia de Informação e Apuração do ICMS) - dia 15 do mês seguinte
  for (let i = 1; i <= 3; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const competenciaDisplay = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const dataVencimentoGIA = new Date(date.getFullYear(), date.getMonth() + 1, 15)

    let statusGIA: ObrigacaoFiscal['status'] = 'PENDENTE'
    if (dataVencimentoGIA < now) {
      statusGIA = 'ATRASADA'
    }

    obrigacoes.push({
      nome: 'GIA - ICMS',
      competencia: competenciaDisplay,
      dataVencimento: dataVencimentoGIA,
      status: statusGIA,
      tipo: 'GIA',
    })
  }

  // DIRF (anual, entrega até fevereiro do ano seguinte)
  const anoAnterior = now.getFullYear() - 1
  const dataVencimentoDIRF = new Date(anoAnterior, 1, 28)
  let statusDIRF: ObrigacaoFiscal['status'] = 'PENDENTE'
  if (dataVencimentoDIRF < now) {
    statusDIRF = 'ATRASADA'
  }
  obrigacoes.push({
    nome: 'DIRF',
    competencia: `${anoAnterior}`,
    dataVencimento: dataVencimentoDIRF,
    status: statusDIRF,
    tipo: 'DIRF',
  })

  // DCTF (trimestral) - último dia útil do mês seguinte ao trimestre
  const trimestreAtual = Math.floor(now.getMonth() / 3)
  for (let t = 0; t < 4; t++) {
    const trimIdx = trimestreAtual - t
    if (trimIdx < 0) continue
    const trimMesFim = (trimIdx + 1) * 3
    const competenciaDisplay = `${now.getFullYear()}-${String(trimMesFim).padStart(2, '0')}`
    const dataVencimentoDCTF = new Date(now.getFullYear(), trimMesFim, 25)

    let statusDCTF: ObrigacaoFiscal['status'] = 'PENDENTE'
    if (dataVencimentoDCTF < now) {
      statusDCTF = 'ATRASADA'
    }

    obrigacoes.push({
      nome: 'DCTF',
      competencia: competenciaDisplay,
      dataVencimento: dataVencimentoDCTF,
      status: statusDCTF,
      tipo: 'DCTF',
    })
  }

  return obrigacoes.sort((a, b) => {
    const ordem = { ATRASADA: 0, PENDENTE: 1, ENTREGUE: 2 }
    return ordem[a.status] - ordem[b.status] || a.dataVencimento.getTime() - b.dataVencimento.getTime()
  })
}
