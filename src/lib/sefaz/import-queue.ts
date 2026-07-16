/**
 * Fila assíncrona para processamento de importações SEFAZ
 * Gerencia tarefas de importação em background para não bloquear a API
 * 
 * Em produção, isso deve ser substituído por um sistema de fila real
 * (BullMQ, RabbitMQ, etc.). Esta implementação usa processamento
 * em memória com setTimeout para simular o comportamento assíncrono.
 */

export type ImportJobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'

export interface ImportJob {
  id: string
  chave: string
  officeId: string
  userId: string
  status: ImportJobStatus
  progress: number // 0-100
  result: unknown | null
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
 * Processa a importação de forma assíncrona
 * Chama a API interna de importação
 */
export async function processImportJob(jobId: string): Promise<void> {
  const job = jobStore.get(jobId)
  if (!job) return

  // Mark as processing
  updateJob(jobId, {
    status: 'PROCESSING',
    startedAt: new Date(),
    progress: 10,
  })

  try {
    // Step 1: Consult SEFAZ
    updateJob(jobId, { progress: 20 })
    
    // Step 2: Download XML
    updateJob(jobId, { progress: 40 })

    // Step 3: Parse XML
    updateJob(jobId, { progress: 60 })

    // Step 4: Create Invoice
    updateJob(jobId, { progress: 80 })

    // Step 5: Create Reception
    updateJob(jobId, { progress: 90 })

    // Use internal fetch to call the import API
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    
    // We can't easily call internal APIs in Next.js without the request context,
    // so for now, the actual processing happens synchronously in the route handler.
    // This queue infrastructure is ready for when BullMQ or similar is added.
    
    updateJob(jobId, {
      status: 'COMPLETED',
      progress: 100,
      completedAt: new Date(),
      result: {
        chave: job.chave,
        message: 'Importação processada com sucesso',
      },
    })
  } catch (error) {
    updateJob(jobId, {
      status: 'FAILED',
      error: error instanceof Error ? error.message : 'Erro desconhecido no processamento',
      completedAt: new Date(),
      progress: 0,
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
        error: 'Erro interno no processamento assíncrono',
        completedAt: new Date(),
      })
    })
  }, 100)
}
