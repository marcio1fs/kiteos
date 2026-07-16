/**
 * Fiscal Dashboard Service
 *
 * Aggregates fiscal data for the KiteOS dashboard, including:
 * - Summary of NF-e, CT-e, NFS-e counts
 * - Compliance alerts
 * - Fiscal obligations tracking
 * - Tax summaries (ICMS, IPI, PIS, COFINS, ISSQN)
 * - Monthly charts data
 */

import { db } from '@/lib/db';
import { getObrigacoesFromService, type ObrigacaoFiscal } from './obrigacoes-service';

// =============================================
// TYPES
// =============================================

export interface FiscalDashboardData {
  resumo: {
    totalNfeEntrada: number
    totalNfeSaida: number
    totalCte: number
    totalNfse: number
    nfePendentesConferencia: number
    manifestacoesPendentes: number
    certificadoDiasVencimento: number | null
  }
  alertas: FiscalAlertaData[]
  obrigacoes: ObrigacaoFiscal[]
  impostos: {
    totalIcms: number
    totalIpi: number
    totalPis: number
    totalCofins: number
    totalIssqn: number
  }
  graficosMensais: Array<{
    mes: string // AAAA-MM
    nfeEntrada: number
    nfeSaida: number
    nfse: number
    impostos: number
  }>
}

export interface FiscalAlertaData {
  id: string
  tipo: string
  severidade: string
  titulo: string
  descricao: string
  dados: string | null
  referenciaId: string | null
  referenciaTipo: string | null
  lido: boolean
  resolvido: boolean
  dataVencimento: Date | null
  officeId: string
  createdAt: Date
  updatedAt: Date
}

export type { ObrigacaoFiscal } from './obrigacoes-service';

// =============================================
// DASHBOARD DATA AGGREGATION
// =============================================

/**
 * Get complete fiscal dashboard data for an office.
 */
export async function getFiscalDashboard(officeId: string): Promise<FiscalDashboardData> {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  // Run queries in parallel for performance
  const [
    nfeEntrada,
    nfeSaida,
    ctes,
    nfseList,
    nfePendentes,
    manifestacoesPendentes,
    certificado,
    impostosNfeEntrada,
    impostosNfeSaida,
    impostosNfse,
    alertas,
  ] = await Promise.all([
    // NF-e Entrada (importadas de fornecedores)
    db.invoice.count({
      where: { officeId, deleted: false, tipoOperacao: 'ENTRADA' },
    }),

    // NF-e Saída (emitidas para clientes)
    db.clientInvoice.count({
      where: { officeId, deleted: false, status: 'EMITIDA' },
    }),

    // CT-e
    db.conhecimentoTransporte.count({
      where: { officeId, deleted: false },
    }),

    // NFS-e
    db.nfseServico.count({
      where: { officeId, deleted: false, status: 'EMITIDA' },
    }),

    // NF-e pendentes de conferência
    db.invoice.count({
      where: { officeId, deleted: false, status: 'IMPORTADA' },
    }),

    // Manifestações pendentes (NF-e recebidas sem manifestação em 180 dias)
    db.manifestacaoDestinatario.count({
      where: {
        officeId,
        status: 'PENDENTE',
        dataEvento: { gte: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000) },
      },
    }),

    // Certificado digital ativo
    db.certificadoDigital.findFirst({
      where: { officeId, ativo: true, deleted: false },
      orderBy: { validade: 'desc' },
    }),

    // Impostos NF-e Entrada (mês atual)
    db.invoice.aggregate({
      _sum: { valorIcms: true, valorIpi: true, valorPis: true, valorCofins: true },
      where: {
        officeId,
        deleted: false,
        dataEmissao: { gte: startOfMonth },
      },
    }),

    // Impostos NF-e Saída (mês atual)
    db.clientInvoice.aggregate({
      _sum: { valorIcms: true, valorIpi: true, valorPis: true, valorCofins: true },
      where: {
        officeId,
        deleted: false,
        dataEmissao: { gte: startOfMonth },
      },
    }),

    // ISSQN NFS-e (mês atual)
    db.nfseServico.aggregate({
      _sum: { valorIssqn: true, valorPis: true, valorCofins: true },
      where: {
        officeId,
        deleted: false,
        status: 'EMITIDA',
        dataEmissao: { gte: startOfMonth },
      },
    }),

    // Alertas fiscais ativos
    db.fiscalAlerta.findMany({
      where: { officeId, resolvido: false },
      orderBy: [
        { severidade: 'desc' },
        { dataVencimento: 'asc' },
      ],
    }),
  ])

  // Calcular dias para vencimento do certificado
  let certificadoDiasVencimento: number | null = null
  if (certificado?.validade) {
    const diffMs = certificado.validade.getTime() - now.getTime()
    certificadoDiasVencimento = Math.ceil(diffMs / (1000 * 60 * 60 * 24))
  }

  // Calcular totais de impostos
  const totalIcms = Number(impostosNfeEntrada._sum.valorIcms || 0) + Number(impostosNfeSaida._sum.valorIcms || 0)
  const totalIpi = Number(impostosNfeEntrada._sum.valorIpi || 0) + Number(impostosNfeSaida._sum.valorIpi || 0)
  const totalPis = Number(impostosNfeEntrada._sum.valorPis || 0) + Number(impostosNfeSaida._sum.valorPis || 0) + Number(impostosNfse._sum.valorPis || 0)
  const totalCofins = Number(impostosNfeEntrada._sum.valorCofins || 0) + Number(impostosNfeSaida._sum.valorCofins || 0) + Number(impostosNfse._sum.valorCofins || 0)
  const totalIssqn = Number(impostosNfse._sum.valorIssqn || 0)

  // Gerar dados dos gráficos mensais (últimos 12 meses)
  const graficosMensais = await getGraficosMensais(officeId, 12)

  // Gerar obrigações fiscais
  const obrigacoes = await getObrigacoesFromService(officeId)

  return {
    resumo: {
      totalNfeEntrada: nfeEntrada,
      totalNfeSaida: nfeSaida,
      totalCte: ctes,
      totalNfse: nfseList,
      nfePendentesConferencia: nfePendentes,
      manifestacoesPendentes,
      certificadoDiasVencimento,
    },
    alertas: alertas.map(a => ({
      id: a.id,
      tipo: a.tipo,
      severidade: a.severidade,
      titulo: a.titulo,
      descricao: a.descricao,
      dados: a.dados,
      referenciaId: a.referenciaId,
      referenciaTipo: a.referenciaTipo,
      lido: a.lido,
      resolvido: a.resolvido,
      dataVencimento: a.dataVencimento,
      officeId: a.officeId,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
    obrigacoes,
    impostos: {
      totalIcms: Math.round(totalIcms * 100) / 100,
      totalIpi: Math.round(totalIpi * 100) / 100,
      totalPis: Math.round(totalPis * 100) / 100,
      totalCofins: Math.round(totalCofins * 100) / 100,
      totalIssqn: Math.round(totalIssqn * 100) / 100,
    },
    graficosMensais,
  }
}

// =============================================
// GRÁFICOS MENSAIS
// =============================================

async function getGraficosMensais(officeId: string, meses: number): Promise<FiscalDashboardData['graficosMensais']> {
  const now = new Date()
  const resultado: FiscalDashboardData['graficosMensais'] = []

  for (let i = meses - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const mesKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    const inicioMes = new Date(date.getFullYear(), date.getMonth(), 1)
    const fimMes = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59)

    const [nfeEnt, nfeSai, nfse, impostosEnt, impostosSai, impostosNfs] = await Promise.all([
      db.invoice.count({
        where: { officeId, deleted: false, tipoOperacao: 'ENTRADA', dataEmissao: { gte: inicioMes, lte: fimMes } },
      }),
      db.clientInvoice.count({
        where: { officeId, deleted: false, dataEmissao: { gte: inicioMes, lte: fimMes } },
      }),
      db.nfseServico.count({
        where: { officeId, deleted: false, status: 'EMITIDA', dataEmissao: { gte: inicioMes, lte: fimMes } },
      }),
      db.invoice.aggregate({
        _sum: { valorIcms: true, valorIpi: true, valorPis: true, valorCofins: true },
        where: { officeId, deleted: false, dataEmissao: { gte: inicioMes, lte: fimMes } },
      }),
      db.clientInvoice.aggregate({
        _sum: { valorIcms: true, valorIpi: true, valorPis: true, valorCofins: true },
        where: { officeId, deleted: false, dataEmissao: { gte: inicioMes, lte: fimMes } },
      }),
      db.nfseServico.aggregate({
        _sum: { valorIssqn: true },
        where: { officeId, deleted: false, status: 'EMITIDA', dataEmissao: { gte: inicioMes, lte: fimMes } },
      }),
    ])

    const totalImpostos =
      Number(impostosEnt._sum.valorIcms || 0) +
      Number(impostosEnt._sum.valorIpi || 0) +
      Number(impostosEnt._sum.valorPis || 0) +
      Number(impostosEnt._sum.valorCofins || 0) +
      Number(impostosSai._sum.valorIcms || 0) +
      Number(impostosSai._sum.valorIpi || 0) +
      Number(impostosSai._sum.valorPis || 0) +
      Number(impostosSai._sum.valorCofins || 0) +
      Number(impostosNfs._sum.valorIssqn || 0)

    resultado.push({
      mes: mesKey,
      nfeEntrada: nfeEnt,
      nfeSaida: nfeSai,
      nfse: nfse,
      impostos: Math.round(totalImpostos * 100) / 100,
    })
  }

  return resultado
}

// Obrigações fiscais são importadas do serviço compartilhado
// getObrigacoesFromService em ./obrigacoes-service

// =============================================
// GERAÇÃO DE ALERTAS FISCAIS
// =============================================

/**
 * Generate fiscal alerts based on current data.
 * Checks for various compliance issues and creates/updates alerts.
 */
export async function generateFiscalAlerts(officeId: string): Promise<FiscalAlertaData[]> {
  const now = new Date()
  const createdAlerts: FiscalAlertaData[] = []

  // 1. CERTIFICADO_VENCENDO - Certificate expiring within 30 days
  const certificado = await db.certificadoDigital.findFirst({
    where: { officeId, ativo: true, deleted: false },
    orderBy: { validade: 'desc' },
  })

  if (certificado?.validade) {
    const diasParaVencer = Math.ceil((certificado.validade.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
    if (diasParaVencer <= 30 && diasParaVencer > 0) {
      const existing = await db.fiscalAlerta.findFirst({
        where: { officeId, tipo: 'CERTIFICADO_VENCENDO', referenciaId: certificado.id, resolvido: false },
      })
      if (!existing) {
        const alerta = await db.fiscalAlerta.create({
          data: {
            tipo: 'CERTIFICADO_VENCENDO',
            severidade: diasParaVencer <= 7 ? 'CRITICO' : 'AVISO',
            titulo: 'Certificado Digital Vencendo',
            descricao: `O certificado digital expira em ${diasParaVencer} dia(s). Renove para evitar interrupção na emissão de NF-e e NFS-e.`,
            dados: JSON.stringify({ validade: certificado.validade.toISOString(), diasParaVencer }),
            referenciaId: certificado.id,
            referenciaTipo: 'CertificadoDigital',
            dataVencimento: certificado.validade,
            officeId,
          },
        })
        createdAlerts.push(alerta as unknown as FiscalAlertaData)
      }
    } else if (diasParaVencer <= 0) {
      const existing = await db.fiscalAlerta.findFirst({
        where: { officeId, tipo: 'CERTIFICADO_VENCENDO', referenciaId: certificado.id, resolvido: false },
      })
      if (!existing) {
        const alerta = await db.fiscalAlerta.create({
          data: {
            tipo: 'CERTIFICADO_VENCENDO',
            severidade: 'CRITICO',
            titulo: 'Certificado Digital Expirado',
            descricao: `O certificado digital expirou há ${Math.abs(diasParaVencer)} dia(s). A emissão de documentos fiscais pode estar bloqueada.`,
            dados: JSON.stringify({ validade: certificado.validade.toISOString(), diasParaVencer }),
            referenciaId: certificado.id,
            referenciaTipo: 'CertificadoDigital',
            dataVencimento: certificado.validade,
            officeId,
          },
        })
        createdAlerts.push(alerta as unknown as FiscalAlertaData)
      }
    }
  }

  // 2. NF_PENDENTE_CONFERENCIA - Invoices imported but not yet conferred
  const nfePendentes = await db.invoice.findMany({
    where: { officeId, deleted: false, status: 'IMPORTADA' },
    take: 10,
  })
  if (nfePendentes.length > 0) {
    const existing = await db.fiscalAlerta.findFirst({
      where: { officeId, tipo: 'NF_PENDENTE_CONFERENCIA', resolvido: false },
    })
    if (!existing) {
      const alerta = await db.fiscalAlerta.create({
        data: {
          tipo: 'NF_PENDENTE_CONFERENCIA',
          severidade: nfePendentes.length > 5 ? 'CRITICO' : 'AVISO',
          titulo: 'NF-e Pendentes de Conferência',
          descricao: `${nfePendentes.length} nota(s) fiscal(is) importada(s) aguardando conferência. Realize a conferência para atualizar estoque e financeiro.`,
          dados: JSON.stringify({ quantidade: nfePendentes.length, ids: nfePendentes.map(n => n.id) }),
          referenciaTipo: 'Invoice',
          officeId,
        },
      })
      createdAlerts.push(alerta as unknown as FiscalAlertaData)
    }
  }

  // 3. MANIFESTACAO_PENDENTE - NF-e received but not manifested (within 180 days)
  const manifestacoes = await db.manifestacaoDestinatario.count({
    where: {
      officeId,
      status: 'PENDENTE',
      dataEvento: { gte: new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000) },
    },
  })
  if (manifestacoes > 0) {
    const existing = await db.fiscalAlerta.findFirst({
      where: { officeId, tipo: 'MANIFESTACAO_PENDENTE', resolvido: false },
    })
    if (!existing) {
      const alerta = await db.fiscalAlerta.create({
        data: {
          tipo: 'MANIFESTACAO_PENDENTE',
          severidade: manifestacoes > 3 ? 'CRITICO' : 'AVISO',
          titulo: 'Manifestações Pendentes',
          descricao: `${manifestacoes} NF-e recebida(s) sem manifestação do destinatário. A manifestação é obrigatória dentro de 180 dias.`,
          dados: JSON.stringify({ quantidade: manifestacoes }),
          referenciaTipo: 'ManifestacaoDestinatario',
          officeId,
        },
      })
      createdAlerts.push(alerta as unknown as FiscalAlertaData)
    }
  }

  // 4. SPED_PENDENTE - SPED not generated for past months
  const mesPassado = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const competenciaPassada = `${mesPassado.getFullYear()}${String(mesPassado.getMonth() + 1).padStart(2, '0')}`
  const spedExiste = await db.spedRegistro.findFirst({
    where: { officeId, periodo: competenciaPassada },
  })
  if (!spedExiste) {
    const existing = await db.fiscalAlerta.findFirst({
      where: { officeId, tipo: 'SPED_PENDENTE', resolvido: false },
    })
    if (!existing) {
      const dataVencSPED = new Date(mesPassado.getFullYear(), mesPassado.getMonth() + 1, 20)
      const alerta = await db.fiscalAlerta.create({
        data: {
          tipo: 'SPED_PENDENTE',
          severidade: now > dataVencSPED ? 'CRITICO' : 'AVISO',
          titulo: 'SPED Fiscal Pendente',
          descricao: `O SPED Fiscal do período ${mesPassado.getFullYear()}-${String(mesPassado.getMonth() + 1).padStart(2, '0')} ainda não foi gerado.${now > dataVencSPED ? ' O prazo de entrega já venceu!' : ''}`,
          dados: JSON.stringify({ competencia: competenciaPassada }),
          referenciaTipo: 'SpedRegistro',
          dataVencimento: dataVencSPED,
          officeId,
        },
      })
      createdAlerts.push(alerta as unknown as FiscalAlertaData)
    }
  }

  // 5. CTE_PENDENTE - CT-e not yet imported (received but not conferidas)
  const ctesPendentes = await db.conhecimentoTransporte.count({
    where: { officeId, deleted: false, status: 'IMPORTADA' },
  })
  if (ctesPendentes > 0) {
    const existing = await db.fiscalAlerta.findFirst({
      where: { officeId, tipo: 'CTE_PENDENTE', resolvido: false },
    })
    if (!existing) {
      const alerta = await db.fiscalAlerta.create({
        data: {
          tipo: 'CTE_PENDENTE',
          severidade: 'AVISO',
          titulo: 'CT-e Pendentes de Conferência',
          descricao: `${ctesPendentes} conhecimento(s) de transporte importado(s) aguardando conferência.`,
          dados: JSON.stringify({ quantidade: ctesPendentes }),
          referenciaTipo: 'ConhecimentoTransporte',
          officeId,
        },
      })
      createdAlerts.push(alerta as unknown as FiscalAlertaData)
    }
  }

  // 6. NFS_EMITIDA_SEM_ENVIO - NFS-e generated but not sent to city
  const nfseSemEnvio = await db.nfseServico.count({
    where: { officeId, deleted: false, status: 'EMITIDA', xmlContent: { not: null } },
  })
  // If we have NFS-e with XML but no explicit "enviada" tracking, warn about it
  // In practice, the XML is generated but the actual submission to the city is manual
  if (nfseSemEnvio > 0) {
    const existing = await db.fiscalAlerta.findFirst({
      where: { officeId, tipo: 'NFS_EMITIDA_SEM_ENVIO', resolvido: false },
    })
    if (!existing) {
      const alerta = await db.fiscalAlerta.create({
        data: {
          tipo: 'NFS_EMITIDA_SEM_ENVIO',
          severidade: 'INFO',
          titulo: 'NFS-e Emitidas - Verificar Envio',
          descricao: `${nfseSemEnvio} NFS-e emitida(s) no sistema. Verifique se foram enviadas ao portal da prefeitura.`,
          dados: JSON.stringify({ quantidade: nfseSemEnvio }),
          referenciaTipo: 'NfseServico',
          officeId,
        },
      })
      createdAlerts.push(alerta as unknown as FiscalAlertaData)
    }
  }

  // 7. DIVERGENCIA_FISCAL - Invoices with divergence in conference
  const nfeDivergentes = await db.invoice.count({
    where: { officeId, deleted: false, status: 'DIVERGENTE' },
  })
  if (nfeDivergentes > 0) {
    const existing = await db.fiscalAlerta.findFirst({
      where: { officeId, tipo: 'DIVERGENCIA_FISCAL', resolvido: false },
    })
    if (!existing) {
      const alerta = await db.fiscalAlerta.create({
        data: {
          tipo: 'DIVERGENCIA_FISCAL',
          severidade: 'CRITICO',
          titulo: 'Divergências Fiscais',
          descricao: `${nfeDivergentes} nota(s) fiscal(is) com divergência na conferência. Verifique e corrija as divergências para evitar problemas fiscais.`,
          dados: JSON.stringify({ quantidade: nfeDivergentes }),
          referenciaTipo: 'Invoice',
          officeId,
        },
      })
      createdAlerts.push(alerta as unknown as FiscalAlertaData)
    }
  }

  // 8. OBRIGACAO_VENCENDO - Fiscal obligations due within 7 days
  const obrigacoes = await getObrigacoesFromService(officeId)
  const obrigacoesProximas = obrigacoes.filter(o =>
    o.status === 'PENDENTE' &&
    o.dataVencimento >= now &&
    o.dataVencimento <= new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  )

  for (const obr of obrigacoesProximas) {
    const existing = await db.fiscalAlerta.findFirst({
      where: {
        officeId,
        tipo: 'OBRIGACAO_VENCENDO',
        referenciaTipo: obr.tipo,
        resolvido: false,
      },
    })
    if (!existing) {
      const diasParaVencer = Math.ceil((obr.dataVencimento.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      const alerta = await db.fiscalAlerta.create({
        data: {
          tipo: 'OBRIGACAO_VENCENDO',
          severidade: diasParaVencer <= 2 ? 'CRITICO' : 'AVISO',
          titulo: `${obr.nome} Vencendo`,
          descricao: `A obrigação fiscal "${obr.nome}" (${obr.competencia}) vence em ${diasParaVencer} dia(s).`,
          dados: JSON.stringify({ competencia: obr.competencia, tipo: obr.tipo }),
          referenciaTipo: obr.tipo,
          dataVencimento: obr.dataVencimento,
          officeId,
        },
      })
      createdAlerts.push(alerta as unknown as FiscalAlertaData)
    }
  }

  return createdAlerts
}
