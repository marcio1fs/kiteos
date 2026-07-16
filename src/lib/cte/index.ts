/**
 * Index de exportação do módulo CT-e
 * Conhecimento de Transporte Eletrônico
 */

export {
  consultaCte,
  downloadCte,
  mapCteErrorToFriendly,
  type CteClientConfig,
  type CteConsultaResponse,
  type CteDownloadResponse,
  type CteConsultaResult,
  type CteDownloadResult,
} from './cte-client'

export {
  parseCteXml,
  validateCteChave,
  validateCteXmlStructure,
  extractModelFromChave,
  type ParsedCte,
} from './cte-parser'
