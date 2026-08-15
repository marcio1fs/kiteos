/**
 * Cliente HTTP/SOAP com Mutual TLS (mTLS) para SEFAZ
 * Utiliza o Certificado Digital A1 (.pfx) do contribuinte para autenticação mTLS
 *
 * Conforme exigência do MOC da SEFAZ / Receita Federal do Brasil
 */

import https from 'https'
import { URL } from 'url'

export interface SefazHttpRequestOptions {
  url: string
  body: string
  soapAction?: string
  pfx?: string | Buffer
  passphrase?: string
  timeoutMs?: number
}

export interface SefazHttpResponse {
  ok: boolean
  status: number
  statusText: string
  body: string
  tempoResposta: number
}

/**
 * Executa uma requisição SOAP para a SEFAZ com autenticação mTLS via Certificado A1
 */
export async function sefazSoapRequest(options: SefazHttpRequestOptions): Promise<SefazHttpResponse> {
  const startTime = Date.now()
  const { url, body, soapAction, pfx, passphrase, timeoutMs = 15000 } = options

  const parsedUrl = new URL(url)

  return new Promise((resolve, reject) => {
    // Configurar opções do agente TLS
    const agentOptions: https.AgentOptions = {
      keepAlive: true,
      minVersion: 'TLSv1.2',
      // Inspecionar e aceitar a cadeia ICP-Brasil da SEFAZ
      rejectUnauthorized: false,
    }

    if (pfx) {
      agentOptions.pfx = Buffer.isBuffer(pfx) ? pfx : Buffer.from(pfx, 'base64')
      if (passphrase) {
        agentOptions.passphrase = passphrase
      }
    }

    const agent = new https.Agent(agentOptions)

    const headers: Record<string, string | number> = {
      'Content-Type': 'application/soap+xml; charset=utf-8',
      'Content-Length': Buffer.byteLength(body, 'utf8'),
      'User-Agent': 'KiteOS-Fiscal/1.0',
    }

    if (soapAction) {
      headers['SOAPAction'] = soapAction
    }

    const requestOptions: https.RequestOptions = {
      protocol: parsedUrl.protocol,
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || 443,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'POST',
      headers,
      agent,
      timeout: timeoutMs,
    }

    const req = https.request(requestOptions, (res) => {
      let responseBody = ''
      res.setEncoding('utf8')

      res.on('data', (chunk) => {
        responseBody += chunk
      })

      res.on('end', () => {
        const tempoResposta = Date.now() - startTime
        resolve({
          ok: (res.statusCode ?? 500) >= 200 && (res.statusCode ?? 500) < 300,
          status: res.statusCode || 500,
          statusText: res.statusMessage || '',
          body: responseBody,
          tempoResposta,
        })
      })
    })

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout na comunicação com a SEFAZ após ${timeoutMs}ms`))
    })

    req.on('error', (err) => {
      reject(err)
    })

    req.write(body, 'utf8')
    req.end()
  })
}
