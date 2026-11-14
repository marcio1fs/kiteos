/** Sondas de caracterização de defeitos. PASSAR significa reproduzir o risco, não aprovação de segurança. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { EventEmitter } from 'node:events';

const h = vi.hoisted(() => ({
  db: {
    user: { findUnique: vi.fn() },
    office: { findUnique: vi.fn(), update: vi.fn() },
    tokenBlacklist: { findFirst: vi.fn(async () => null), create: vi.fn() },
    refreshToken: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  fetch: vi.fn(),
  agentOptions: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ db: h.db }));
vi.mock('@/lib/token-encryption', () => ({ encryptToken: (v: any) => v, decryptToken: (v: any) => v }));
vi.mock('https', () => {
  class Agent { constructor(options: any) { h.agentOptions(options); } destroy() {} }
  const request = vi.fn((_options: any, callback: any) => {
    const req: any = new EventEmitter();
    req.write = vi.fn();
    req.destroy = vi.fn();
    req.end = vi.fn(() => {
      const res: any = new EventEmitter();
      res.statusCode = 200; res.statusMessage = 'OK'; res.setEncoding = vi.fn();
      callback(res); res.emit('end');
    });
    return req;
  });
  return { default: { Agent, request }, Agent, request };
});
import { signToken, requireAuth, rotateRefreshToken } from '@/lib/auth';
import { PUT as whatsappConfig } from '@/app/api/whatsapp/config/route';
import { sefazSoapRequest } from '@/lib/sefaz/mtls-client';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', h.fetch);
  process.env.JWT_SECRET = 'audit-only-jwt-secret-with-more-than-32-characters';
  h.db.tokenBlacklist.findFirst.mockResolvedValue(null);
});

describe('Sondas de segurança com dependências simuladas', () => {
  it('JWT de usuário desativado continua autorizado quando não há blacklist explícita', async () => {
    h.db.user.findUnique.mockResolvedValue({ id: 'user-A', active: false, deleted: false });
    const token = await signToken({ userId: 'user-A', officeId: 'office-A', role: 'ADMIN' });
    const result = await requireAuth(new Request('https://audit.invalid/api/clients', { headers: { Authorization: `Bearer ${token}` } }), 'office-A');
    expect(result.payload?.userId).toBe('user-A');
    expect(h.db.user.findUnique).not.toHaveBeenCalled();
  });

  it('Refresh renova sessão sem revalidar usuário, office ou papel atual', async () => {
    h.db.refreshToken.findUnique.mockResolvedValue({ id: 'refresh-A', token: 'old-token', userId: 'user-A', officeId: 'office-A', role: 'ADMIN', isRevoked: false, expiresAt: new Date(Date.now() + 86400000) });
    h.db.user.findUnique.mockResolvedValue({ id: 'user-A', active: false, role: 'EMPLOYEE' });
    const result = await rotateRefreshToken('old-token');
    expect(result?.payload.role).toBe('ADMIN');
    expect(h.db.refreshToken.create).toHaveBeenCalled();
    expect(h.db.user.findUnique).not.toHaveBeenCalled();
  });

  it('Configuração WhatsApp permite URL interna arbitrária no teste de conexão (SSRF)', async () => {
    h.fetch.mockResolvedValue({ ok: true });
    const token = await signToken({ userId: 'user-A', officeId: 'office-A', role: 'EMPLOYEE' });
    const request = new NextRequest('https://audit.invalid/api/whatsapp/config', { method: 'PUT', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ officeId: 'office-A', waApiUrl: 'http://169.254.169.254/latest', waInstance: 'instance', waApiToken: 'secret', testOnly: true }) });
    const response = await whatsappConfig(request);
    expect(response.status).toBe(200);
    expect(h.fetch.mock.calls[0][0]).toContain('http://169.254.169.254/instances/instance/token/secret/status');
  });

  it('Cliente mTLS desativa a validação do certificado do servidor', async () => {
    await sefazSoapRequest({ url: 'https://sefaz.example.invalid/ws', body: '<xml/>', pfx: Buffer.from('audit-only-not-a-real-key').toString('base64'), passphrase: 'audit' });
    expect(h.agentOptions.mock.calls[0][0].rejectUnauthorized).toBe(false);
  });
});
