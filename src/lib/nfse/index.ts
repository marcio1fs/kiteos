/**
 * NFS-e (Nota Fiscal de Serviços Eletrônica) Module
 *
 * Business logic for generating and managing NFS-e for mechanic workshops.
 * Follows Brazilian municipal ISSQN rules and LC 116/2003 service list.
 */

export {
  calculateIssqn,
  validateNfseData,
  generateNfseXml,
  getCurrentCompetencia,
  formatNfseCurrency,
  getServicoDescricao,
  SERVICOS_OFICINA,
  ALIQ_ISSQN_PADRAO,
} from './nfse-service'

export type {
  NfseServicoData,
  IssqnCalculation,
  OfficeData,
} from './nfse-service'
