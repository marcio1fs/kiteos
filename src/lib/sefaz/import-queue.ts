/**
 * Fila assíncrona para processamento de importações SEFAZ.
 *
 * FISC-04: `processImportJob` marcava COMPLETED depois de "etapas" que só
 * atualizavam um número de progresso — sem consultar a SEFAZ, sem baixar XML e sem
 * gravar nota. O usuário acreditava que a NF-e tinha sido importada. O job agora
 * chama `importNfeByChave`, o mesmo núcleo da rota síncrona, e só conclui quando
 * existe nota persistida; qualquer outra coisa vira FAILED com o motivo real.
 *
 * Limitação honesta e ainda aberta: o store é em memória (Map + setTimeout), então
 * jobs se perdem em restart/deploy e não há retry/backoff nem coordenação entre
 * instâncias. Uma fila persistente (BullMQ ou similar) continua pendente. O que
 * sobrevive a restart é o registro durável em `sefazConsultas` / `invoices`, que o
 * núcleo grava independentemente do job.
 */

import { importNfeByChave } from './nfe-import'

export type ImportJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface ImportJob {
  id: string
  chave: string
  officeId: string
  userId: string
  status: ImportJobStatus
  progress: number // 0-100
  result: unknown | null
  /** Código do motivo da falha, para o cliente não interpretar texto. */
  failureCode: string | null
  error: string | null
  createdAt: Date
  startedAt: Date | null
  completedAt: Date | null
}

// In-memory job store
const jobStore = new Map<string, ImportJob>()

// Clean up completed jobs older than 1 hour
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000
    for (const [id, job] of jobStore.entries()) {
      if (job.completedAt && job.completedAt.getTime() < oneHourAgo) {
        jobStore.delete(id)
      }
    }
  }, 10 * 60 * 1000) // every 10 minutes
}

/**
 * Cria um novo job de importação
 */
export function createImportJob(chave: string, officeId: string, userId: string): ImportJob {
  const id = `import_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
  
  const job: ImportJob = {
    id,
    chave,
    officeId,
    userId,
    status: 'PENDING',
    progress: 0,
    result: null,
    failureCode: null,
    error: null,
    createdAt: new Date(),
    startedAt: null,
    completedAt: null,
  }

  jobStore.set(id, job)
  return job
}

/**
 * Obtém o status de um job
 */
export function getImportJob(jobId: string): ImportJob | null {
  return jobStore.get(jobId) || null
}

/**
 * Lista jobs de um office
 */
export function listImportJobs(officeId: string): ImportJob[] {
  return Array.from(jobStore.values())
    .filter(job => job.officeId === officeId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 50) // max 50 recent jobs
}

/**
 * Atualiza o status de um job
 */
function updateJob(jobId: string, updates: Partial<ImportJob>): void {
  const job = jobStore.get(jobId)
  if (job) {
    Object.assign(job, updates)
  }
}

/**
 * Processa a importação executando o trabalho real.
 *
 * `COMPLETED` exige nota persistida: o resultado carrega `invoiceId` e chave.
 * Falha de negócio (sem certificado, NF-e não autorizada, XML inválido) e exceção
 * inesperada terminam em `FAILED` com o motivo verdadeiro.
 */
export async function processImportJob(jobId: string): Promise<void> {
  const job = jobStore.get(jobId)
  if (!job) return

  updateJob(jobId, {
    status: 'PROCESSING',
    startedAt: new Date(),
    progress: 10,
    failureCode: null,
    error: null,
  })

  try {
    const result = await importNfeByChave({
      chave: job.chave,
      officeId: job.officeId,
      userId: job.userId,
    })

    if (!result.ok) {
      updateJob(jobId, {
        status: 'FAILED',
        progress: 0,
        completedAt: new Date(),
        failureCode: result.code,
        error: result.error,
        result: result.data ?? null,
      })
      return
    }

    updateJob(jobId, {
      status: 'COMPLETED',
      progress: 100,
      completedAt: new Date(),
      failureCode: null,
      error: null,
      result: {
        chave: result.chave,
        invoiceId: result.invoiceId,
        numero: result.numero,
        fornecedor: result.fornecedor,
        valorTotal: result.valorTotal,
        message: 'NF-e importada e gravada',
      },
    })
  } catch (error) {
    updateJob(jobId, {
      status: 'FAILED',
      progress: 0,
      completedAt: new Date(),
      failureCode: 'INTERNAL_ERROR',
      error: error instanceof Error ? error.message : 'Erro desconhecido no processamento',
    })
  }
}

/**
 * Inicia o processamento assíncrono de um job
 * Usa setTimeout para não bloquear a resposta da API
 */
export function startAsyncProcessing(jobId: string): void {
  // Delay processing slightly to return the job ID to the client first
  setTimeout(() => {
    processImportJob(jobId).catch(err => {
      console.error('Erro no processamento assíncrono:', err)
      updateJob(jobId, {
        status: 'FAILED',
        failureCode: 'INTERNAL_ERROR',
        error: 'Erro interno no processamento assíncrono',
        completedAt: new Date(),
      })
    })
  }, 100)
}
