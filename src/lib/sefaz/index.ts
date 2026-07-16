/**
 * Index de exportação do módulo SEFAZ
 */

export { getSefazEndpoint, getUfFromChave, getSupportedUfs, type Ambiente, type SefazEndpoint } from './endpoints'
export { buildConsultaProtocoloEnvelope, buildDownloadNfeEnvelope, buildStatusServicoEnvelope } from './soap-builder'
export { encryptPassword, decryptPassword, encryptFileContent, decryptFileContent, validatePfxBasic, maskSensitiveData } from './certificate'
export { parseConsultaProtocoloResponse, parseDownloadNfeResponse, parseStatusServicoResponse, mapSefazErrorToFriendly, type SefazConsultaResult, type SefazDownloadResult } from './response-parser'
export { consultaProtocolo, downloadNfe, consultaStatusServico, type SefazClientConfig, type SefazConsultaResponse, type SefazDownloadResponse, type SefazStatusResponse } from './sefaz-client'
export { checkRateLimit, applyRateLimit, type RateLimitType, type RateLimitResult } from './rate-limiter'
export { createImportJob, getImportJob, listImportJobs, startAsyncProcessing, type ImportJob, type ImportJobStatus } from './import-queue'
export { enviarManifestacao, buildManifestacaoEnvelope, parseManifestacaoResponse, mapManifestacaoErrorToFriendly, MANIFESTACAO_EVENTOS, type TipoManifestacao, type ManifestacaoConfig, type ManifestacaoResult } from './manifestacao'
