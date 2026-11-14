import https from 'node:https';
import http from 'node:http';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF guard for tenant-configured outbound URLs.
 * - HTTPS only (http allowed only outside production for local gateways).
 * - Rejects credentials, localhost and private/reserved address ranges.
 * - Pins the validated IP in the TLS connection to prevent DNS rebinding.
 * - Does not follow redirects.
 */
export class UnsafeUrlError extends Error {
  constructor(message: string) { super(message); this.name = 'UnsafeUrlError'; }
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower.startsWith('::ffff:')) return isPrivateAddress(lower.slice(7));
    return lower === '::' || lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') ||
      lower.startsWith('fe80') || lower.startsWith('ff');
  }
  return true;
}

export async function validateExternalUrl(rawUrl: string): Promise<{ url: URL; address: string; family: number }> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new UnsafeUrlError('URL inválida'); }
  const allowHttp = process.env.NODE_ENV !== 'production';
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new UnsafeUrlError('A URL da API deve usar HTTPS');
  }
  if (url.username || url.password) throw new UnsafeUrlError('URL não deve conter credenciais');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new UnsafeUrlError('Endereço local não permitido');
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError('Endereço IP privado/reservado não permitido');
    return { url, address: host, family: isIP(host) };
  }
  let records;
  try { records = await lookup(host, { all: true, verbatim: true }); }
  catch { throw new UnsafeUrlError('Não foi possível resolver o endereço da API'); }
  if (!records.length) throw new UnsafeUrlError('Endereço da API sem registros DNS');
  for (const record of records) {
    if (isPrivateAddress(record.address)) throw new UnsafeUrlError('Endereço da API resolve para rede privada/reservada');
  }
  return { url, address: records[0].address, family: records[0].family };
}

export async function safeExternalFetch(rawUrl: string, init: {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
} = {}): Promise<Response> {
  const { url, address, family } = await validateExternalUrl(rawUrl);
  const timeoutMs = init.timeoutMs ?? 15_000;
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise<Response>((resolve, reject) => {
    const req = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      method: init.method || 'GET',
      headers: { ...init.headers, Host: url.host },
      // Pin the address we validated; TLS SNI/verification still uses hostname.
      lookup: (_hostname, _options, callback) => callback(null, address, family),
      servername: url.hostname,
      rejectUnauthorized: true,
      timeout: timeoutMs,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          req.destroy(new Error('Resposta externa excede o tamanho máximo'));
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => {
        const headers = new Headers();
        for (const [key, value] of Object.entries(res.headers)) {
          if (value === undefined) continue;
          headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
        }
        resolve(new Response(Buffer.concat(chunks), { status: res.statusCode || 502, headers }));
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error(`Timeout após ${timeoutMs}ms`)));
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
