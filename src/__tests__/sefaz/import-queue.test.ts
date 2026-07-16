/**
 * Testes unitários do Import Queue
 */

import { describe, it, expect } from 'vitest'
import {
  createImportJob,
  getImportJob,
  listImportJobs,
  type ImportJobStatus,
} from '@/lib/sefaz/import-queue'

describe('Import Queue', () => {
  describe('createImportJob', () => {
    it('deve criar um job com status PENDING', () => {
      const job = createImportJob('12345678901234567890123456789012345678901234', 'office1', 'user1')
      
      expect(job.id).toBeDefined()
      expect(job.chave).toBe('12345678901234567890123456789012345678901234')
      expect(job.officeId).toBe('office1')
      expect(job.userId).toBe('user1')
      expect(job.status).toBe('PENDING')
      expect(job.progress).toBe(0)
      expect(job.result).toBeNull()
      expect(job.error).toBeNull()
      expect(job.createdAt).toBeInstanceOf(Date)
    })
  })

  describe('getImportJob', () => {
    it('deve recuperar um job existente', () => {
      const created = createImportJob('12345678901234567890123456789012345678901234', 'office1', 'user1')
      const fetched = getImportJob(created.id)
      
      expect(fetched).not.toBeNull()
      expect(fetched!.id).toBe(created.id)
      expect(fetched!.chave).toBe(created.chave)
    })

    it('deve retornar null para job inexistente', () => {
      const result = getImportJob('nonexistent-job-id')
      expect(result).toBeNull()
    })
  })

  describe('listImportJobs', () => {
    it('deve listar jobs de um office', () => {
      const officeId = `list-test-${Date.now()}`
      createImportJob('11111111111111111111111111111111111111111111', officeId, 'user1')
      createImportJob('22222222222222222222222222222222222222222222', officeId, 'user1')
      
      const jobs = listImportJobs(officeId)
      expect(jobs.length).toBeGreaterThanOrEqual(2)
    })

    it('deve retornar lista vazia para office sem jobs', () => {
      const jobs = listImportJobs(`no-jobs-${Date.now()}`)
      expect(jobs).toHaveLength(0)
    })

    it('deve limitar a 50 jobs mais recentes', () => {
      const officeId = `limit-test-${Date.now()}`
      // Criar mais de 50 jobs
      for (let i = 0; i < 55; i++) {
        createImportJob(`${i.toString().padStart(44, '0')}`, officeId, 'user1')
      }
      
      const jobs = listImportJobs(officeId)
      expect(jobs.length).toBeLessThanOrEqual(50)
    })
  })
})
