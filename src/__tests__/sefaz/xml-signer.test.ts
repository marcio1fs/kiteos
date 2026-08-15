import { describe, it, expect, beforeAll } from 'vitest'
import forge from 'node-forge'
import {
  extractPfxData,
  canonicalizeC14N,
  signXml,
  verifyXmlSignature,
} from '@/lib/sefaz/xml-signer'
import { buildManifestacaoEnvelope } from '@/lib/sefaz/manifestacao'

// Helper to generate a dummy PKCS#12 PFX for testing
function generateTestPfx(password: string): Buffer {
  const keys = forge.pki.rsa.generateKeyPair(1024)
  const cert = forge.pki.createCertificate()
  cert.publicKey = keys.publicKey
  cert.serialNumber = '01'
  cert.validity.notBefore = new Date()
  cert.validity.notAfter = new Date()
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1)

  const attrs = [
    { name: 'commonName', value: 'OFICINA TESTE LTDA:12345678000195' },
    { name: 'organizationName', value: 'OFICINA TESTE LTDA' },
    { name: 'countryName', value: 'BR' },
  ]
  cert.setSubject(attrs)
  cert.setIssuer(attrs)
  cert.sign(keys.privateKey, forge.md.sha256.create())

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], password)
  const p12Der = forge.asn1.toDer(p12Asn1).getBytes()
  return Buffer.from(p12Der, 'binary')
}

describe('SEFAZ XML Digital Signer (XMLDSig)', () => {
  const testPassword = 'testePassword123'
  let pfxBuffer: Buffer

  beforeAll(() => {
    pfxBuffer = generateTestPfx(testPassword)
  })

  it('should extract private key, public cert, and metadata from PFX', () => {
    const certData = extractPfxData(pfxBuffer, testPassword)

    expect(certData.privateKeyPem).toContain('BEGIN RSA PRIVATE KEY')
    expect(certData.certPem).toContain('BEGIN CERTIFICATE')
    expect(certData.certBase64).toBeTruthy()
    expect(certData.subject.cnpjCpf).toBe('12345678000195')
    expect(certData.subject.organization).toBe('OFICINA TESTE LTDA')
    expect(certData.notAfter.getTime()).toBeGreaterThan(Date.now())
  })

  it('should throw when password is wrong', () => {
    expect(() => extractPfxData(pfxBuffer, 'wrongPassword')).toThrow()
  })

  it('should canonicalize XML string according to C14N rules', () => {
    const inputXml = `
      <infEvento Id="ID123"  versao="1.00"   xmlns="http://www.portalfiscal.inf.br/nfe" >
        <cOrgao>91</cOrgao>
      </infEvento>
    `
    const canonical = canonicalizeC14N(inputXml)

    expect(canonical).not.toContain('<?xml')
    // Attributes should be sorted: Id, versao, xmlns (or Id, xmlns, versao)
    expect(canonical).toContain('<infEvento')
    expect(canonical).toContain('</infEvento>')
  })

  it('should digitally sign an XML document with RSA-SHA1 and XMLDSig structure', () => {
    const xmlToSign = `
      <evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">
        <infEvento Id="ID2102103521011234567800019555001000000001100000001001">
          <cOrgao>91</cOrgao>
          <tpAmb>2</tpAmb>
          <CNPJ>12345678000195</CNPJ>
          <chNFe>35210112345678000195550010000000011000000010</chNFe>
          <dhEvento>2026-08-14T20:00:00-03:00</dhEvento>
          <tpEvento>210210</tpEvento>
          <nSeqEvento>1</nSeqEvento>
          <verEvento>1.00</verEvento>
          <detEvento versao="1.00">
            <descEvento>Ciencia da Operacao</descEvento>
          </detEvento>
        </infEvento>
      </evento>
    `

    const result = signXml({
      xml: xmlToSign,
      tagToSign: 'infEvento',
      pfx: pfxBuffer,
      passphrase: testPassword,
    })

    expect(result.success).toBe(true)
    expect(result.signedXml).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">')
    expect(result.signedXml).toContain('<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">')
    expect(result.signedXml).toContain('<CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/>')
    expect(result.signedXml).toContain('<SignatureMethod Algorithm="http://www.w3.org/2000/09/xmldsig#rsa-sha1"/>')
    expect(result.signedXml).toContain('<DigestMethod Algorithm="http://www.w3.org/2000/09/xmldsig#sha1"/>')
    expect(result.signedXml).toContain('<DigestValue>')
    expect(result.signedXml).toContain('<SignatureValue>')
    expect(result.signedXml).toContain('<X509Certificate>')

    // Verify cryptographic validity
    const verification = verifyXmlSignature(result.signedXml)
    expect(verification.valid).toBe(true)
  })

  it('should generate signed Manifestação SOAP envelope when certificate is provided', () => {
    const envelope = buildManifestacaoEnvelope(
      '35210112345678000195550010000000011000000010',
      'CIENCIA_OPERACAO',
      '12345678000195',
      'HOMOLOGACAO',
      undefined,
      { pfx: pfxBuffer, passphrase: testPassword }
    )

    expect(envelope).toContain('<soap12:Envelope')
    expect(envelope).toContain('<nfeDadosMsg')
    expect(envelope).toContain('<infEvento Id="ID2102103521011234567800019555001000000001100000001001">')
    expect(envelope).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">')
    expect(envelope).toContain('<SignatureValue>')
    expect(envelope).toContain('<X509Certificate>')
  })
})
