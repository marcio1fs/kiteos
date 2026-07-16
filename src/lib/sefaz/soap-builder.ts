/**
 * Construção de envelopes SOAP para webservices SEFAZ
 * Conforme leiaute NF-e 4.00 (NT 2014.002)
 *
 * SECURITY FIXES:
 * - Added XML escaping to ALL user-provided values in SOAP envelopes
 * - Fixed getUfCode to throw on invalid UF instead of silently falling back to BA
 */

/**
 * Escapa caracteres especiais XML para prevenir SOAP injection
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * SOAP envelope para Consulta Protocolo NF-e (nfeConsultaNF)
 * Serviço: NfeConsultaProtocolo4
 */
export function buildConsultaProtocoloEnvelope(
  chave: string,
  ambiente: string,
  uf: string,
  cnpjCpf: string
): string {
  const tpAmb = ambiente === 'PRODUCAO' ? '1' : '2'
  const cufCode = getUfCode(uf)
  const safeChave = escapeXml(chave)

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap12:Header>
    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">
      <cUF>${cufCode}</cUF>
      <versaoDados>4.00</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeConsultaProtocolo4">
      <consSitNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>${tpAmb}</tpAmb>
        <xServ>CONSULTAR</xServ>
        <chNFe>${safeChave}</chNFe>
      </consSitNFe>
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`
}

/**
 * SOAP envelope para Download NF-e (nfeDownloadNF)
 * Serviço: NfeDownloadNF4
 */
export function buildDownloadNfeEnvelope(
  chave: string,
  ambiente: string,
  uf: string,
  cnpjCpf: string
): string {
  const tpAmb = ambiente === 'PRODUCAO' ? '1' : '2'
  const cufCode = getUfCode(uf)
  const safeChave = escapeXml(chave)
  const safeCnpjCpf = escapeXml(cnpjCpf)

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap12:Header>
    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeDownloadNF4">
      <cUF>${cufCode}</cUF>
      <versaoDados>4.00</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NfeDownloadNF4">
      <downloadNFe xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>${tpAmb}</tpAmb>
        <xServ>DOWNLOAD NFE</xServ>
        <CNPJ>${safeCnpjCpf}</CNPJ>
        <chNFe>${safeChave}</chNFe>
      </downloadNFe>
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`
}

/**
 * SOAP envelope para Status Serviço (nfeStatusServicoNF)
 */
export function buildStatusServicoEnvelope(
  ambiente: string,
  uf: string
): string {
  const tpAmb = ambiente === 'PRODUCAO' ? '1' : '2'
  const cufCode = getUfCode(uf)

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap12:Header>
    <nfeCabecMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">
      <cUF>${cufCode}</cUF>
      <versaoDados>4.00</versaoDados>
    </nfeCabecMsg>
  </soap12:Header>
  <soap12:Body>
    <nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">
      <consStatServ xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00">
        <tpAmb>${tpAmb}</tpAmb>
        <cUF>${cufCode}</cUF>
        <xServ>STATUS</xServ>
      </consStatServ>
    </nfeDadosMsg>
  </soap12:Body>
</soap12:Envelope>`
}

/**
 * Retorna o código numérico da UF
 * SECURITY FIX: Throws error for invalid UF instead of silently defaulting to BA (29)
 */
function getUfCode(uf: string): string {
  const codes: Record<string, string> = {
    AC: '12', AL: '27', AP: '16', AM: '13', BA: '29',
    CE: '23', DF: '53', ES: '32', GO: '52', MA: '21',
    MG: '31', MS: '50', MT: '51', PA: '15', PB: '25',
    PE: '26', PI: '22', PR: '41', RJ: '33', RN: '24',
    RO: '11', RR: '14', RS: '43', SC: '42', SE: '28',
    SP: '35', TO: '17',
  }
  const code = codes[uf.toUpperCase()]
  if (!code) {
    throw new Error(`UF inválida: "${uf}". UF deve ser uma das 27 unidades federativas válidas.`)
  }
  return code
}

export { escapeXml, getUfCode }
