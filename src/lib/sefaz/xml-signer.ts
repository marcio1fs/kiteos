/**
 * Assinador Digital de XML para Documentos e Eventos Fiscais (NF-e, CT-e, MDF-e, NFS-e, Manifestação)
 * Padrão XMLDSig (W3C / Manual de Orientação do Contribuinte - MOC / NT SEFAZ)
 *
 * Algoritmos:
 * - Canonicalização: C14N (http://www.w3.org/TR/2001/REC-xml-c14n-20010315)
 * - Assinatura: RSA-SHA1 (http://www.w3.org/2000/09/xmldsig#rsa-sha1) ou RSA-SHA256
 * - Digest: SHA-1 (http://www.w3.org/2000/09/xmldsig#sha1) ou SHA-256
 * - Transformações: Enveloped Signature + C14N
 */

import crypto from 'crypto'
import forge from 'node-forge'

export interface ExtractedCertData {
  privateKeyPem: string
  certPem: string
  certBase64: string
  notBefore: Date
  notAfter: Date
  subject: {
    commonName?: string
    organization?: string
    cnpjCpf?: string
  }
  issuer: {
    commonName?: string
    organization?: string
  }
}

export interface SignXmlOptions {
  xml: string
  tagToSign: 'infEvento' | 'infNFe' | 'infCte' | 'infMDFe' | 'infInut' | 'infCanc' | 'infRps' | string
  pfx: string | Buffer
  passphrase: string
  algorithm?: 'sha1' | 'sha256'
}

export interface SignXmlResult {
  success: boolean
  signedXml: string
  signatureValue?: string
  digestValue?: string
  error?: string
}

/**
 * Extrai Chave Privada, Certificado X.509 e Metadados do arquivo PFX (PKCS#12)
 */
export function extractPfxData(pfxInput: string | Buffer, passphrase: string): ExtractedCertData {
  const pfxBuffer = Buffer.isBuffer(pfxInput)
    ? pfxInput
    : Buffer.from(pfxInput, 'base64')

  const pfxAsn1 = forge.asn1.fromDer(pfxBuffer.toString('binary'))
  const pfx = forge.pkcs12.pkcs12FromAsn1(pfxAsn1, passphrase)

  // 1. Obter bags de chave privada
  let privateKeyForge: forge.pki.PrivateKey | null = null
  for (const safeContents of pfx.safeContents) {
    for (const safeBag of safeContents.safeBags) {
      if (safeBag.key) {
        privateKeyForge = safeBag.key
        break
      }
    }
    if (privateKeyForge) break
  }

  if (!privateKeyForge) {
    throw new Error('Chave privada não encontrada no arquivo PFX')
  }

  // 2. Obter bags de certificado
  let certForge: forge.pki.Certificate | null = null
  for (const safeContents of pfx.safeContents) {
    for (const safeBag of safeContents.safeBags) {
      if (safeBag.cert) {
        certForge = safeBag.cert
        break
      }
    }
    if (certForge) break
  }

  if (!certForge) {
    throw new Error('Certificado X.509 não encontrado no arquivo PFX')
  }

  const privateKeyPem = forge.pki.privateKeyToPem(privateKeyForge)
  const certPem = forge.pki.certificateToPem(certForge)

  // Obter Base64 puro do DER do certificado (sem headers PEM)
  const certDer = forge.asn1.toDer(forge.pki.certificateToAsn1(certForge)).getBytes()
  const certBase64 = Buffer.from(certDer, 'binary').toString('base64')

  // Metadados do Subject
  const commonName = certForge.subject.getField('CN')?.value as string | undefined
  const organization = certForge.subject.getField('O')?.value as string | undefined

  // Extrair CNPJ ou CPF do Common Name ou atributos ICP-Brasil
  let cnpjCpf: string | undefined
  if (commonName) {
    const parts = commonName.split(':')
    if (parts.length > 1) {
      const candidate = parts[parts.length - 1].replace(/\D/g, '')
      if (candidate.length === 14 || candidate.length === 11) {
        cnpjCpf = candidate
      }
    }
  }

  const issuerCn = certForge.issuer.getField('CN')?.value as string | undefined
  const issuerOrg = certForge.issuer.getField('O')?.value as string | undefined

  return {
    privateKeyPem,
    certPem,
    certBase64,
    notBefore: certForge.validity.notBefore,
    notAfter: certForge.validity.notAfter,
    subject: {
      commonName,
      organization,
      cnpjCpf,
    },
    issuer: {
      commonName: issuerCn,
      organization: issuerOrg,
    },
  }
}

/**
 * Normaliza e Canonicaliza trecho XML conforme especificação C14N (W3C Canonical XML 1.0)
 * Adequado para validação nos servidores SEFAZ
 */
export function canonicalizeC14N(xmlString: string): string {
  if (!xmlString) return ''

  let clean = xmlString
    // Remove declaração XML inicial se houver
    .replace(/<\?xml[^>]*\?>/gi, '')
    // Remove comentários XML
    .replace(/<!--[\s\S]*?-->/g, '')
    // Normaliza quebras de linha para \n
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove espaços entre tags seletivamente sem destruir conteúdo
    .replace(/>\s+([a-zA-Z0-9_\-\.\:\/]+)/g, '>$1')
    .replace(/([a-zA-Z0-9_\-\.\:\/]+)\s+</g, '$1<')
    .trim()

  // Ordena atributos alfabeticamente nas tags de abertura
  clean = clean.replace(/<([a-zA-Z0-9_\:\-]+)(\s+[^>]+)>/g, (_match, tagName, attrsStr) => {
    const attrRegex = /([a-zA-Z0-9_\:\-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g
    const attrs: Array<{ name: string; value: string }> = []
    let attrMatch: RegExpExecArray | null

    while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
      const name = attrMatch[1]
      const value = attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[3]
      attrs.push({ name, value })
    }

    // Ordenar atributos alfabeticamente (critério C14N)
    attrs.sort((a, b) => a.name.localeCompare(b.name))

    const formattedAttrs = attrs
      .map(a => `${a.name}="${escapeXmlAttr(a.value)}"`)
      .join(' ')

    return formattedAttrs ? `<${tagName} ${formattedAttrs}>` : `<${tagName}>`
  })

  return clean
}

function escapeXmlAttr(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Assina digitalmente um documento XML conforme o padrão SEFAZ (XMLDSig)
 */
export function signXml(options: SignXmlOptions): SignXmlResult {
  try {
    const { xml, tagToSign, pfx, passphrase, algorithm = 'sha1' } = options

    // Extrair certificados e chave privada
    const certData = extractPfxData(pfx, passphrase)

    // Localizar elemento alvo
    const tagRegex = new RegExp(`<(${tagToSign})([^>]*)>([\\s\\S]*?)</\\1>`, 'i')
    const match = xml.match(tagRegex)

    if (!match) {
      return {
        success: false,
        signedXml: xml,
        error: `Tag alvo <${tagToSign}> não encontrada no XML fornecido`,
      }
    }

    const fullTargetElement = match[0]
    const attributesStr = match[2]

    // Extrair atributo Id (ex: Id="ID210210...")
    const idMatch = attributesStr.match(/Id\s*=\s*["']([^"']+)["']/i)
    const targetId = idMatch ? idMatch[1] : ''

    // 1. Canonicalizar o elemento alvo (C14N)
    const canonicalTarget = canonicalizeC14N(fullTargetElement)

    // 2. Calcular DigestValue (SHA-1)
    const hashAlgorithm = algorithm === 'sha256' ? 'sha256' : 'sha1'
    const digestValue = crypto
      .createHash(hashAlgorithm)
      .update(canonicalTarget, 'utf8')
      .digest('base64')

    // 3. Montar SignedInfo
    const c14nMethod = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'
    const sigMethod = algorithm === 'sha256'
      ? 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256'
      : 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
    const digMethod = algorithm === 'sha256'
      ? 'http://www.w3.org/2001/04/xmlenc#sha256'
      : 'http://www.w3.org/2000/09/xmldsig#sha1'
    const referenceUri = targetId ? `#${targetId}` : ''

    const signedInfoBlock = `<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">` +
      `<CanonicalizationMethod Algorithm="${c14nMethod}"/>` +
      `<SignatureMethod Algorithm="${sigMethod}"/>` +
      `<Reference URI="${referenceUri}">` +
        `<Transforms>` +
          `<Transform Algorithm="http://www.w3.org/2000/09/xmldsig#enveloped-signature"/>` +
          `<Transform Algorithm="${c14nMethod}"/>` +
        `</Transforms>` +
        `<DigestMethod Algorithm="${digMethod}"/>` +
        `<DigestValue>${digestValue}</DigestValue>` +
      `</Reference>` +
    `</SignedInfo>`

    // 4. Canonicalizar o SignedInfo
    const canonicalSignedInfo = canonicalizeC14N(signedInfoBlock)

    // 5. Assinar o SignedInfo com a Chave Privada RSA
    const signMethodNode = algorithm === 'sha256' ? 'RSA-SHA256' : 'RSA-SHA1'
    const signer = crypto.createSign(signMethodNode)
    signer.update(canonicalSignedInfo, 'utf8')
    const signatureValue = signer.sign(certData.privateKeyPem, 'base64')

    // 6. Montar o bloco completo <Signature>
    const signatureXml = `<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` +
      signedInfoBlock +
      `<SignatureValue>${signatureValue}</SignatureValue>` +
      `<KeyInfo>` +
        `<X509Data>` +
          `<X509Certificate>${certData.certBase64}</X509Certificate>` +
        `</X509Data>` +
      `</KeyInfo>` +
    `</Signature>`

    // 7. Inserir a assinatura logo após o fechamento da tag alvo </tagToSign>
    const signedXml = xml.replace(fullTargetElement, `${fullTargetElement}${signatureXml}`)

    return {
      success: true,
      signedXml,
      signatureValue,
      digestValue,
    }
  } catch (error) {
    return {
      success: false,
      signedXml: options.xml,
      error: error instanceof Error ? error.message : 'Erro ao assinar XML',
    }
  }
}

/**
 * Verifica a validade da assinatura digital de um XML assinado
 */
export function verifyXmlSignature(signedXml: string): { valid: boolean; error?: string } {
  try {
    const sigMatch = signedXml.match(/<Signature[\s\S]*?<\/Signature>/i)
    if (!sigMatch) {
      return { valid: false, error: 'Tag <Signature> não encontrada no XML' }
    }

    const certMatch = signedXml.match(/<X509Certificate>([\s\S]*?)<\/X509Certificate>/i)
    if (!certMatch || !certMatch[1]) {
      return { valid: false, error: 'Tag <X509Certificate> não encontrada na assinatura' }
    }

    const sigValMatch = signedXml.match(/<SignatureValue>([\s\S]*?)<\/SignatureValue>/i)
    if (!sigValMatch || !sigValMatch[1]) {
      return { valid: false, error: 'Tag <SignatureValue> não encontrada na assinatura' }
    }

    const signedInfoMatch = signedXml.match(/<SignedInfo[\s\S]*?<\/SignedInfo>/i)
    if (!signedInfoMatch || !signedInfoMatch[0]) {
      return { valid: false, error: 'Tag <SignedInfo> não encontrada na assinatura' }
    }

    const certBase64 = certMatch[1].replace(/\s+/g, '')
    const signatureValue = sigValMatch[1].replace(/\s+/g, '')
    const canonicalSignedInfo = canonicalizeC14N(signedInfoMatch[0])

    const certPem = `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g)?.join('\n')}\n-----END CERTIFICATE-----`

    const verifier = crypto.createVerify('RSA-SHA1')
    verifier.update(canonicalSignedInfo, 'utf8')
    const isValid = verifier.verify(certPem, signatureValue, 'base64')

    return { valid: isValid, error: isValid ? undefined : 'Assinatura criptográfica RSA-SHA1 inválida' }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : 'Erro na verificação da assinatura' }
  }
}
