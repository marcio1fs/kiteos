/**
 * Mapeamento de endpoints SEFAZ por UF
 * Webservices de Consulta NF-e e Download NF-e
 * Conforme NT 2014.002 e atualizações
 */

export type Ambiente = 'HOMOLOGACAO' | 'PRODUCAO'

export interface SefazEndpoint {
  consulta: string    // NfeConsultaProtocolo
  download: string    // NfeDownloadNF
  statusServico: string // NfeStatusServico
}

/**
 * Endpoints de homologação por UF
 */
const HOMOLOGACAO_ENDPOINTS: Record<string, SefazEndpoint> = {
  AC: {
    consulta: 'https://homologacao.sefaznet.ac.gov.br/nfeweb/services/NFeConsultaProtocolo4',
    download: 'https://homologacao.sefaznet.ac.gov.br/nfeweb/services/NfeDownloadNF4',
    statusServico: 'https://homologacao.sefaznet.ac.gov.br/nfeweb/services/NFeStatusServico4',
  },
  AL: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  AP: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  AM: {
    consulta: 'https://homologacao.sefaz.am.gov.br/services2/services/NfeConsultaProtocolo4',
    download: 'https://homologacao.sefaz.am.gov.br/services2/services/NfeDownloadNF4',
    statusServico: 'https://homologacao.sefaz.am.gov.br/services2/services/NfeStatusServico4',
  },
  BA: {
    consulta: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    download: 'https://hnfe.sefaz.ba.gov.br/webservices/NfeDownloadNF4/NfeDownloadNF4.asmx',
    statusServico: 'https://hnfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx',
  },
  CE: {
    consulta: 'https://nfeh.sefaz.ce.gov.br/nfe4/services/NFeConsultaProtocolo4',
    download: 'https://nfeh.sefaz.ce.gov.br/nfe4/services/NfeDownloadNF4',
    statusServico: 'https://nfeh.sefaz.ce.gov.br/nfe4/services/NFeStatusServico4',
  },
  DF: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  ES: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  GO: {
    consulta: 'https://homolog.sefaz.go.gov.br/nfe/services/v4/NfeConsultaProtocolo4',
    download: 'https://homolog.sefaz.go.gov.br/nfe/services/v4/NfeDownloadNF4',
    statusServico: 'https://homolog.sefaz.go.gov.br/nfe/services/v4/NfeStatusServico4',
  },
  MA: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  MG: {
    consulta: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
    download: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NfeDownloadNF4',
    statusServico: 'https://hnfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
  },
  MS: {
    consulta: 'https://homologacao.nfe.ms.gov.br/ws/NFeConsultaProtocolo4',
    download: 'https://homologacao.nfe.ms.gov.br/ws/NfeDownloadNF4',
    statusServico: 'https://homologacao.nfe.ms.gov.br/ws/NFeStatusServico4',
  },
  MT: {
    consulta: 'https://homologacao.sefaz.mt.gov.br/nfeweb/services/NfeConsultaProtocolo4',
    download: 'https://homologacao.sefaz.mt.gov.br/nfeweb/services/NfeDownloadNF4',
    statusServico: 'https://homologacao.sefaz.mt.gov.br/nfeweb/services/NfeStatusServico4',
  },
  PA: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  PB: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  PE: {
    consulta: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4',
    download: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NfeDownloadNF4',
    statusServico: 'https://nfehomolog.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4',
  },
  PI: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  PR: {
    consulta: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4',
    download: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NfeDownloadNF4',
    statusServico: 'https://homologacao.nfe.sefa.pr.gov.br/nfe/NFeStatusServico4',
  },
  RJ: {
    consulta: 'https://homologacao.nfe.fazenda.rj.gov.br/ws/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    download: 'https://homologacao.nfe.fazenda.rj.gov.br/ws/NfeDownloadNF4/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.fazenda.rj.gov.br/ws/NFeStatusServico4/NFeStatusServico4.asmx',
  },
  RN: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  RO: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  RR: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  RS: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  SC: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  SE: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  SP: {
    consulta: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
    download: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx',
  },
  TO: {
    consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
}

/**
 * Endpoints de produção por UF
 */
const PRODUCAO_ENDPOINTS: Record<string, SefazEndpoint> = {
  AC: {
    consulta: 'https://www.sefaznet.ac.gov.br/nfeweb/services/NFeConsultaProtocolo4',
    download: 'https://www.sefaznet.ac.gov.br/nfeweb/services/NfeDownloadNF4',
    statusServico: 'https://www.sefaznet.ac.gov.br/nfeweb/services/NFeStatusServico4',
  },
  AL: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  AP: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  AM: {
    consulta: 'https://sistemas.sefaz.am.gov.br/services2/services/NfeConsultaProtocolo4',
    download: 'https://sistemas.sefaz.am.gov.br/services2/services/NfeDownloadNF4',
    statusServico: 'https://sistemas.sefaz.am.gov.br/services2/services/NfeStatusServico4',
  },
  BA: {
    consulta: 'https://nfe.sefaz.ba.gov.br/webservices/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    download: 'https://nfe.sefaz.ba.gov.br/webservices/NfeDownloadNF4/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.ba.gov.br/webservices/NFeStatusServico4/NFeStatusServico4.asmx',
  },
  CE: {
    consulta: 'https://nfe.sefaz.ce.gov.br/nfe4/services/NFeConsultaProtocolo4',
    download: 'https://nfe.sefaz.ce.gov.br/nfe4/services/NfeDownloadNF4',
    statusServico: 'https://nfe.sefaz.ce.gov.br/nfe4/services/NFeStatusServico4',
  },
  DF: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  ES: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  GO: {
    consulta: 'https://nfe.sefaz.go.gov.br/nfe/services/v4/NfeConsultaProtocolo4',
    download: 'https://nfe.sefaz.go.gov.br/nfe/services/v4/NfeDownloadNF4',
    statusServico: 'https://nfe.sefaz.go.gov.br/nfe/services/v4/NfeStatusServico4',
  },
  MA: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  MG: {
    consulta: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeConsultaProtocolo4',
    download: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NfeDownloadNF4',
    statusServico: 'https://nfe.fazenda.mg.gov.br/nfe2/services/NFeStatusServico4',
  },
  MS: {
    consulta: 'https://nfe.ms.gov.br/ws/NFeConsultaProtocolo4',
    download: 'https://nfe.ms.gov.br/ws/NfeDownloadNF4',
    statusServico: 'https://nfe.ms.gov.br/ws/NFeStatusServico4',
  },
  MT: {
    consulta: 'https://sefaz.mt.gov.br/nfeweb/services/NfeConsultaProtocolo4',
    download: 'https://sefaz.mt.gov.br/nfeweb/services/NfeDownloadNF4',
    statusServico: 'https://sefaz.mt.gov.br/nfeweb/services/NfeStatusServico4',
  },
  PA: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  PB: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  PE: {
    consulta: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeConsultaProtocolo4',
    download: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NfeDownloadNF4',
    statusServico: 'https://nfe.sefaz.pe.gov.br/nfe-service/services/NFeStatusServico4',
  },
  PI: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  PR: {
    consulta: 'https://nfe.sefa.pr.gov.br/nfe/NFeConsultaProtocolo4',
    download: 'https://nfe.sefa.pr.gov.br/nfe/NfeDownloadNF4',
    statusServico: 'https://nfe.sefa.pr.gov.br/nfe/NFeStatusServico4',
  },
  RJ: {
    consulta: 'https://nfe.fazenda.rj.gov.br/ws/NFeConsultaProtocolo4/NFeConsultaProtocolo4.asmx',
    download: 'https://nfe.fazenda.rj.gov.br/ws/NfeDownloadNF4/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.fazenda.rj.gov.br/ws/NFeStatusServico4/NFeStatusServico4.asmx',
  },
  RN: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  RO: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  RR: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  RS: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  SC: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  SE: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
  SP: {
    consulta: 'https://nfe.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx',
    download: 'https://nfe.fazenda.sp.gov.br/ws/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx',
  },
  TO: {
    consulta: 'https://nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
    download: 'https://nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
    statusServico: 'https://nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
  },
}

/**
 * Mapa código UF -> sigla UF
 */
const UF_CODE_MAP: Record<string, string> = {
  '12': 'AC', '27': 'AL', '16': 'AP', '13': 'AM', '29': 'BA',
  '23': 'CE', '53': 'DF', '32': 'ES', '52': 'GO', '21': 'MA',
  '31': 'MG', '50': 'MS', '51': 'MT', '15': 'PA', '25': 'PB',
  '26': 'PE', '22': 'PI', '41': 'PR', '33': 'RJ', '24': 'RN',
  '11': 'RO', '14': 'RR', '43': 'RS', '42': 'SC', '28': 'SE',
  '35': 'SP', '17': 'TO',
}

/**
 * Obtém a UF a partir da chave de acesso (posição 0-1 = código UF)
 */
export function getUfFromChave(chave: string): string | null {
  const cleaned = chave.replace(/\D/g, '')
  if (cleaned.length < 2) return null
  const ufCode = cleaned.substring(0, 2)
  return UF_CODE_MAP[ufCode] || null
}

/**
 * Retorna os endpoints para uma UF e ambiente
 */
export function getSefazEndpoint(uf: string, ambiente: Ambiente): SefazEndpoint {
  const normalizedUf = uf.toUpperCase().trim()
  const endpoints = ambiente === 'PRODUCAO' ? PRODUCAO_ENDPOINTS : HOMOLOGACAO_ENDPOINTS
  const endpoint = endpoints[normalizedUf]
  if (!endpoint) {
    return endpoints['RS'] || {
      consulta: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeConsulta/NfeConsulta4.asmx',
      download: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeDownloadNF/NfeDownloadNF4.asmx',
      statusServico: 'https://homologacao.nfe.sefaz.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    }
  }
  return endpoint
}

/**
 * Lista todas as UFs suportadas
 */
export function getSupportedUfs(): string[] {
  return Object.keys(HOMOLOGACAO_ENDPOINTS).sort()
}
