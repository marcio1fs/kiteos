/**
 * Testes unitários do Response Parser SEFAZ
 */

import { describe, it, expect } from 'vitest'
import {
  parseConsultaProtocoloResponse,
  parseDownloadNfeResponse,
  parseStatusServicoResponse,
  mapSefazErrorToFriendly,
} from '@/lib/sefaz/response-parser'

describe('Response Parser SEFAZ', () => {
  describe('parseConsultaProtocoloResponse', () => {
    it('deve extrair dados de NF-e autorizada (cStat=100)', () => {
      const soapResponse = `<?xml version="1.0" encoding="UTF-8"?>
      <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
        <soap:Body>
          <nfeResultMsg>
            <retConsSitNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe">
              <tpAmb>2</tpAmb>
              <verAplic>1.0</verAplic>
              <cStat>100</cStat>
              <xMotivo>Autorizado o uso da NF-e</xMotivo>
              <cUF>29</cUF>
              <chNFe>29230100000000000000550010000000011000000001</chNFe>
              <protNFe versao="4.00">
                <infProt>
                  <tpAmb>2</tpAmb>
                  <verAplic>1.0</verAplic>
                  <chNFe>29230100000000000000550010000000011000000001</chNFe>
                  <dhRecbto>2023-01-15T10:30:00-03:00</dhRecbto>
                  <nProt>129230000000001</nProt>
                  <digVal>abcdef1234567890</digVal>
                  <cStat>100</cStat>
                  <xMotivo>Autorizado o uso da NF-e</xMotivo>
                </infProt>
              </protNFe>
            </retConsSitNFe>
          </nfeResultMsg>
        </soap:Body>
      </soap:Envelope>`

      const result = parseConsultaProtocoloResponse(soapResponse)

      expect(result.cStat).toBe('100')
      expect(result.xMotivo).toBe('Autorizado o uso da NF-e')
      expect(result.chNFe).toBe('29230100000000000000550010000000011000000001')
      expect(result.nfeStatus).toBe('AUTORIZADA')
      expect(result.protocolo).toBe('129230000000001')
      expect(result.dhRecbto).toBe('2023-01-15T10:30:00-03:00')
    })

    it('deve identificar NF-e cancelada (cStat=101)', () => {
      const soapResponse = `<?xml version="1.0"?>
      <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
        <soap:Body>
          <retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe">
            <cStat>101</cStat>
            <xMotivo>Cancelamento de NF-e homologado</xMotivo>
            <chNFe>29230100000000000000550010000000011000000001</chNFe>
          </retConsSitNFe>
        </soap:Body>
      </soap:Envelope>`

      const result = parseConsultaProtocoloResponse(soapResponse)
      expect(result.nfeStatus).toBe('CANCELADA')
    })

    it('deve identificar NF-e denegada (cStat=110)', () => {
      const soapResponse = `<?xml version="1.0"?>
      <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
        <soap:Body>
          <retConsSitNFe xmlns="http://www.portalfiscal.inf.br/nfe">
            <cStat>110</cStat>
            <xMotivo>Uso Denegado</xMotivo>
            <chNFe>29230100000000000000550010000000011000000001</chNFe>
          </retConsSitNFe>
        </soap:Body>
      </soap:Envelope>`

      const result = parseConsultaProtocoloResponse(soapResponse)
      expect(result.nfeStatus).toBe('DENEGADA')
    })
  })

  describe('parseDownloadNfeResponse', () => {
    it('deve extrair XML da NF-e do download', () => {
      const soapResponse = `<?xml version="1.0"?>
      <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
        <soap:Body>
          <retDownloadNFe xmlns="http://www.portalfiscal.inf.br/nfe">
            <cStat>140</cStat>
            <xMotivo>Download disponibilizado</xMotivo>
            <chNFe>29230100000000000000550010000000011000000001</chNFe>
            <procNFe versao="4.00">
              <NFe><infNFe Id="NFe29230100000000000000550010000000011000000001"></infNFe></NFe>
              <protNFe><infProt><nProt>129230000000001</nProt></infProt></protNFe>
            </procNFe>
          </retDownloadNFe>
        </soap:Body>
      </soap:Envelope>`

      const result = parseDownloadNfeResponse(soapResponse)

      expect(result.cStat).toBe('140')
      expect(result.xMotivo).toBe('Download disponibilizado')
      expect(result.xmlContent).not.toBeNull()
      expect(result.xmlContent).toContain('infNFe')
    })
  })

  describe('parseStatusServicoResponse', () => {
    it('deve extrair status de serviço online (cStat=107)', () => {
      const soapResponse = `<?xml version="1.0"?>
      <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope">
        <soap:Body>
          <retConsStatServ xmlns="http://www.portalfiscal.inf.br/nfe">
            <tpAmb>2</tpAmb>
            <verAplic>1.0</verAplic>
            <cStat>107</cStat>
            <xMotivo>Servico em Operacao</xMotivo>
            <cUF>29</cUF>
            <dhRecbto>2023-01-15T10:00:00-03:00</dhRecbto>
            <tMed>1</tMed>
          </retConsStatServ>
        </soap:Body>
      </soap:Envelope>`

      const result = parseStatusServicoResponse(soapResponse)

      expect(result.cStat).toBe('107')
      expect(result.xMotivo).toBe('Servico em Operacao')
      expect(result.tMed).toBe('1')
    })
  })

  describe('mapSefazErrorToFriendly', () => {
    it('deve mapear cStat 100 para mensagem amigável', () => {
      expect(mapSefazErrorToFriendly('100', '')).toContain('autorizada')
    })

    it('deve mapear cStat 217 para NF-e não encontrada', () => {
      expect(mapSefazErrorToFriendly('217', '')).toContain('não consta')
    })

    it('deve retornar xMotivo original para cStat desconhecido', () => {
      const motivo = 'Motivo específico não mapeado'
      expect(mapSefazErrorToFriendly('999', motivo)).toBe(motivo)
    })
  })
})
