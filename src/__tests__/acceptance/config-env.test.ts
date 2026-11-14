/**
 * Passo 6 — configuração e segredos (CFG-01 a CFG-07).
 *
 * Estes testes exigem o comportamento correto que as sondas 18–24 mostram ausente:
 * configuração validada na partida, healthcheck que verifica banco, URL pública sem
 * fallback para localhost, "está configurado?" sem string-matching de placeholder,
 * segredo de oficina nunca gravado em texto puro por omissão, e `.env.example` que
 * corresponde ao que o código lê.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: {
    $queryRaw: vi.fn(),
    office: { findMany: vi.fn(async () => [] as never[]) },
    subscription: { findFirst: vi.fn() },
    auditLog: { create: vi.fn(async () => undefined) },
  },
}));
vi.mock('@/lib/db', () => ({ db: h.db }));

import {
  ConfigError,
  MIN_SECRET_LENGTH,
  getEnv,
  isPlaceholderSecret,
  parsePlatformAdminIds,
  readEnv,
  requireAppUrl,
} from '@/lib/env';

const CHAVE = 'test-encryption-key-for-unit-tests-min-32chars';
const SEGSEDO = 'jwt-secret-com-pelo-menos-32-caracteres-reais';

/** Ambiente mínimo e válido em produção. */
const ENV_VALIDO: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://kiteos:kiteos@db:5432/kiteos?schema=public',
  JWT_SECRET: SEGSEDO,
  CERT_ENCRYPTION_KEY: CHAVE,
  NEXT_PUBLIC_APP_URL: 'https://app.oficina.example.br',
  PLATFORM_ADMIN_USER_IDS: 'user-1,user-2',
};

let restaurar: (() => void) | null = null;

/**
 * Spy de `process.exit` instalado por `chamarRegister()`.
 *
 * `register()` encerra o processo quando a configuração é inválida em produção —
 * comportamento verificado executando o servidor real. Aqui o exit é mockado para
 * o runner não ser derrubado, e o teste ainda confere o código 1 pedido.
 */
let exitSpy: { calls: unknown[][]; restore: () => void } | null = null;

function instalarSpyDeExit(): void {
  // No-op de propósito: assim a execução segue até o `throw` de `failStartup` e o
  // teste observa as duas coisas — o código 1 pedido ao processo e a mensagem que
  // nomeia a variável faltante.
  exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never) as unknown as {
    calls: unknown[][];
    restore: () => void;
  };
}

function codigoDoExit(): unknown {
  return (exitSpy as unknown as { mock: { calls: unknown[][] } } | null)?.mock.calls[0]?.[0];
}

/** Substitui TODO o ambiente pelo cenário dado (nada de herdar variável solta). */
function usarEnv(cenario: Record<string, string | undefined>): void {
  const anterior = { ...process.env };
  for (const key of Object.keys(process.env)) delete process.env[key];
  for (const [key, value] of Object.entries(cenario)) {
    if (value !== undefined) process.env[key] = value;
  }
  restaurar = () => {
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, anterior);
    restaurar = null;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$queryRaw.mockResolvedValue([{ offices: 'offices' }]);
});

afterEach(() => {
  vi.restoreAllMocks();
  exitSpy = null;
  restaurar?.();
});

function nomes(res: ReturnType<typeof readEnv>): string[] {
  return res.errors.map((e) => e.variable);
}

describe('readEnv: configuração válida não produz erro', () => {
  it('aceita o cenário de produção completo', () => {
    usarEnv(ENV_VALIDO);
    const res = readEnv();

    expect(res.ok).toBe(true);
    expect(res.errors).toEqual([]);
    expect(res.config.nodeEnv).toBe('production');
    expect(res.config.isDevLike).toBe(false);
    expect(res.config.appUrl).toBe('https://app.oficina.example.br');
    expect(res.config.platformAdminUserIds).toEqual(['user-1', 'user-2']);
  });

  it('getEnv devolve a configuração e não lança', () => {
    usarEnv(ENV_VALIDO);
    expect(() => getEnv()).not.toThrow();
    expect(getEnv().jwtSecret).toBe(SEGSEDO);
  });
});

describe('readEnv: segredos obrigatórios (CFG-01)', () => {
  it('aponta cada variável obrigatória ausente pelo nome', () => {
    usarEnv({ NODE_ENV: 'production' });
    const res = readEnv();

    expect(res.ok).toBe(false);
    expect(nomes(res)).toEqual(
      expect.arrayContaining(['JWT_SECRET', 'CERT_ENCRYPTION_KEY', 'DATABASE_URL', 'NEXT_PUBLIC_APP_URL'])
    );
  });

  it('recusa segredo curto e diz o mínimo', () => {
    usarEnv({ ...ENV_VALIDO, JWT_SECRET: 'curto' });
    const erro = readEnv().errors.find((e) => e.variable === 'JWT_SECRET');

    expect(erro).toBeDefined();
    expect(erro?.message).toContain(String(MIN_SECRET_LENGTH));
  });

  it('recusa valor de exemplo do .env.example como segredo', () => {
    usarEnv({ ...ENV_VALIDO, JWT_SECRET: 'your-jwt-secret-here', CERT_ENCRYPTION_KEY: 'your-encryption-key-here' });
    expect(nomes(readEnv())).toEqual(expect.arrayContaining(['JWT_SECRET', 'CERT_ENCRYPTION_KEY']));
  });

  it('recusa DATABASE_URL que não é Postgres', () => {
    usarEnv({ ...ENV_VALIDO, DATABASE_URL: 'file:./dev.db' });
    expect(readEnv().errors.find((e) => e.variable === 'DATABASE_URL')?.message).toMatch(/postgres/i);
  });

  it('a mensagem de erro nomeia a variável sem revelar o valor do segredo', () => {
    usarEnv({ ...ENV_VALIDO, JWT_SECRET: 'curto' });
    const erro = new ConfigError(readEnv().errors);

    expect(erro.message).toContain('JWT_SECRET');
    expect(erro.message).not.toContain('curto');
  });
});

describe('readEnv: NODE_ENV ausente ou estranho é produção (CFG-05)', () => {
  it.each([['staging'], ['homolog'], ['prod'], ['Producao']])(
    'NODE_ENV="%s" é tratado como produção',
    (valor) => {
      usarEnv({ ...ENV_VALIDO, NODE_ENV: valor });
      const { config, warnings } = readEnv();

      expect(config.nodeEnv).toBe('production');
      expect(config.isDevLike).toBe(false);
      expect(warnings.map((w) => w.variable)).toContain('NODE_ENV');
    }
  );

  it('NODE_ENV ausente também é produção — e avisa', () => {
    usarEnv({ ...ENV_VALIDO, NODE_ENV: undefined });
    const { config, warnings } = readEnv();

    expect(config.isDevLike).toBe(false);
    expect(warnings.map((w) => w.variable)).toContain('NODE_ENV');
  });

  it('development e test são os únicos ambientes relaxados', () => {
    for (const ambiente of ['development', 'test']) {
      usarEnv({ ...ENV_VALIDO, NODE_ENV: ambiente });
      expect(readEnv().config.isDevLike).toBe(true);
    }
  });

  it('sem CERT_ENCRYPTION_KEY: erro em produção, aviso em desenvolvimento', () => {
    usarEnv({ ...ENV_VALIDO, CERT_ENCRYPTION_KEY: undefined });
    expect(nomes(readEnv())).toContain('CERT_ENCRYPTION_KEY');

    usarEnv({ ...ENV_VALIDO, NODE_ENV: 'development', CERT_ENCRYPTION_KEY: undefined });
    const dev = readEnv();
    expect(nomes(dev)).not.toContain('CERT_ENCRYPTION_KEY');
    expect(dev.warnings.map((w) => w.variable)).toContain('CERT_ENCRYPTION_KEY');
  });
});

describe('readEnv: URL pública (CFG-03)', () => {
  it('ausente em produção é erro — não existe fallback localhost', () => {
    usarEnv({ ...ENV_VALIDO, NEXT_PUBLIC_APP_URL: undefined });
    const res = readEnv();

    expect(nomes(res)).toContain('NEXT_PUBLIC_APP_URL');
    expect(res.config.appUrl).toBeNull();
    expect(() => requireAppUrl()).toThrow(ConfigError);
  });

  it.each([
    ['http://localhost:3000'],
    ['http://127.0.0.1:3000'],
    ['https://app.internal'],
    ['https://192.168.0.10'],
    ['https://kiteos.local'],
  ])('em produção recusa URL não alcançável: %s', (valor) => {
    usarEnv({ ...ENV_VALIDO, NEXT_PUBLIC_APP_URL: valor });
    expect(nomes(readEnv())).toContain('NEXT_PUBLIC_APP_URL');
  });

  it('em produção recusa http:// e URL inválida', () => {
    usarEnv({ ...ENV_VALIDO, NEXT_PUBLIC_APP_URL: 'http://app.oficina.example.br' });
    expect(readEnv().errors.find((e) => e.variable === 'NEXT_PUBLIC_APP_URL')?.message).toMatch(/https/);

    usarEnv({ ...ENV_VALIDO, NEXT_PUBLIC_APP_URL: 'app.oficina.example.br' });
    expect(nomes(readEnv())).toContain('NEXT_PUBLIC_APP_URL');
  });

  it('normaliza barra final e caminho, mantendo só a origem', () => {
    usarEnv({ ...ENV_VALIDO, NEXT_PUBLIC_APP_URL: 'https://app.oficina.example.br/painel/' });
    expect(readEnv().config.appUrl).toBe('https://app.oficina.example.br');
  });

  it('em desenvolvimento aceita localhost e assume http://localhost:3000 se ausente', () => {
    usarEnv({ ...ENV_VALIDO, NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://localhost:3000' });
    expect(readEnv().config.appUrl).toBe('http://localhost:3000');

    usarEnv({ ...ENV_VALIDO, NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: undefined });
    const res = readEnv();
    expect(res.config.appUrl).toBe('http://localhost:3000');
    expect(res.warnings.map((w) => w.variable)).toContain('NEXT_PUBLIC_APP_URL');
  });
});

describe('isPlaceholderSecret: fim do string-matching de "xxxxxxxx" (CFG-04)', () => {
  it.each([
    ['APP_USR-xxxxxxxxxxxxxxxxxxxxxxxx'],
    ['your-jwt-secret-here'],
    ['your-mp-access-token'],
    ['changeme'],
    ['<seu-token-aqui>'],
    ['insert_here'],
    [''],
    ['   '],
  ])('reconhece como placeholder: %j', (valor) => {
    expect(isPlaceholderSecret(valor)).toBe(true);
  });

  it('não marca segredo de verdade como placeholder', () => {
    expect(isPlaceholderSecret('APP_USR-8f3a1c9d2e7b4a6f')).toBe(false);
    expect(isPlaceholderSecret(SEGSEDO)).toBe(false);
    expect(isPlaceholderSecret('TEST-9d41b7a2c8e64f31a5b0c9d8e7f6a5b4')).toBe(false);
  });

  it('null/undefined são placeholder (ausência não é configuração)', () => {
    expect(isPlaceholderSecret(null)).toBe(true);
    expect(isPlaceholderSecret(undefined)).toBe(true);
  });
});

describe('readEnv: Mercado Pago de plataforma (CFG-04)', () => {
  it('token placeholder é ignorado, com aviso, e não conta como configurado', () => {
    usarEnv({
      ...ENV_VALIDO,
      MP_PLATFORM_ACCESS_TOKEN: 'APP_USR-xxxxxxxxxxxxxxxxxxxxxxxx',
      MP_PLATFORM_WEBHOOK_SECRET: undefined,
    });
    const { config, warnings, errors } = readEnv();

    expect(config.mercadoPago.configured).toBe(false);
    expect(config.mercadoPago.accessToken).toBeNull();
    expect(config.mercadoPago.placeholderDetected).toBe(true);
    expect(warnings.map((w) => w.variable)).toContain('MP_PLATFORM_ACCESS_TOKEN');
    // Token ignorado não pode gerar erro de secret ausente.
    expect(errors.map((e) => e.variable)).not.toContain('MP_PLATFORM_WEBHOOK_SECRET');
    expect(errors).toEqual([]);
  });

  it('token real sem secret é erro: webhook não teria como ser autenticado', () => {
    usarEnv({
      ...ENV_VALIDO,
      MP_PLATFORM_ACCESS_TOKEN: 'APP_USR-8f3a1c9d2e7b4a6f0d5c8b2a',
      MP_PLATFORM_WEBHOOK_SECRET: undefined,
    });
    const res = readEnv();

    expect(res.config.mercadoPago.configured).toBe(true);
    expect(nomes(res)).toContain('MP_PLATFORM_WEBHOOK_SECRET');
  });

  it('token real com secret configura a plataforma e detecta sandbox por TEST-', () => {
    usarEnv({
      ...ENV_VALIDO,
      MP_PLATFORM_ACCESS_TOKEN: 'TEST-9d41b7a2c8e64f31a5b0c9d8e7f6a5b4',
      MP_PLATFORM_WEBHOOK_SECRET: 'assinatura-webhook-de-verdade-123456',
    });
    const mp = readEnv().config.mercadoPago;

    expect(mp).toMatchObject({ configured: true, sandbox: true, placeholderDetected: false });
    expect(mp.webhookSecret).toBe('assinatura-webhook-de-verdade-123456');

    usarEnv({
      ...ENV_VALIDO,
      MP_PLATFORM_ACCESS_TOKEN: 'APP_USR-8f3a1c9d2e7b4a6f0d5c8b2a',
      MP_PLATFORM_WEBHOOK_SECRET: 'assinatura-webhook-de-verdade-123456',
    });
    expect(readEnv().config.mercadoPago.sandbox).toBe(false);
  });

  it('secret sem token é avisado (seria ignorado)', () => {
    usarEnv({
      ...ENV_VALIDO,
      MP_PLATFORM_ACCESS_TOKEN: undefined,
      MP_PLATFORM_WEBHOOK_SECRET: 'assinatura-webhook-de-verdade-123456',
    });
    expect(readEnv().warnings.map((w) => w.variable)).toContain('MP_PLATFORM_WEBHOOK_SECRET');
  });
});

describe('parsePlatformAdminIds e o aviso de lockout (CFG-07)', () => {
  it('vírgula é o separador canônico, com trim e dedupe', () => {
    expect(parsePlatformAdminIds(' user-1 , user-2 ,, user-1 ').ids).toEqual(['user-1', 'user-2']);
    expect(parsePlatformAdminIds(' user-1 , user-2 ,, user-1 ').usedFallbackSeparator).toBe(false);
  });

  it('separador errado não perde operador em silêncio: usa fallback e avisa', () => {
    const porPontoEVirgula = parsePlatformAdminIds('user-1;user-2');
    expect(porPontoEVirgula.ids).toEqual(['user-1', 'user-2']);
    expect(porPontoEVirgula.usedFallbackSeparator).toBe(true);

    const porEspaco = parsePlatformAdminIds('user-1 user-2');
    expect(porEspaco.ids).toEqual(['user-1', 'user-2']);
    expect(porEspaco.usedFallbackSeparator).toBe(true);
  });

  it('vazio não dá acesso a ninguém, e readEnv avisa do lockout', () => {
    expect(parsePlatformAdminIds('').ids).toEqual([]);
    expect(parsePlatformAdminIds('   ').ids).toEqual([]);

    usarEnv({ ...ENV_VALIDO, PLATFORM_ADMIN_USER_IDS: '' });
    expect(readEnv().warnings.map((w) => w.variable)).toContain('PLATFORM_ADMIN_USER_IDS');
  });

  it('readEnv popula os ids e usa o separador alternativo com aviso', () => {
    usarEnv({ ...ENV_VALIDO, PLATFORM_ADMIN_USER_IDS: 'user-1;user-2' });
    const res = readEnv();

    expect(res.config.platformAdminUserIds).toEqual(['user-1', 'user-2']);
    expect(res.warnings.map((w) => w.variable)).toContain('PLATFORM_ADMIN_USER_IDS');
  });
});

describe('readEnv: opcionais', () => {
  it('REDIS_URL com esquema errado é erro; ausente é aceitável', () => {
    usarEnv({ ...ENV_VALIDO, REDIS_URL: 'http://localhost:6379' });
    expect(nomes(readEnv())).toContain('REDIS_URL');

    usarEnv({ ...ENV_VALIDO, REDIS_URL: 'rediss://cache:6379' });
    expect(readEnv().ok).toBe(true);
  });

  it('ALLOW_INSECURE_PLAINTEXT_TOKENS em produção é erro; fora dela é opt-in', () => {
    usarEnv({ ...ENV_VALIDO, ALLOW_INSECURE_PLAINTEXT_TOKENS: 'true' });
    expect(nomes(readEnv())).toContain('ALLOW_INSECURE_PLAINTEXT_TOKENS');
    expect(readEnv().config.allowInsecurePlaintextTokens).toBe(false);

    usarEnv({ ...ENV_VALIDO, NODE_ENV: 'development', ALLOW_INSECURE_PLAINTEXT_TOKENS: 'true' });
    expect(readEnv().config.allowInsecurePlaintextTokens).toBe(true);
  });
});

describe('validação na partida — instrumentation.register() (CFG-01)', () => {
  async function chamarRegister() {
    vi.resetModules();
    instalarSpyDeExit();
    const mod = await import('@/instrumentation');
    return mod.register();
  }

  it('em produção, configuração inválida encerra o processo com código 1', async () => {
    usarEnv({ NODE_ENV: 'production', DATABASE_URL: ENV_VALIDO.DATABASE_URL });

    await expect(chamarRegister()).rejects.toThrow(/JWT_SECRET/);
    expect(codigoDoExit()).toBe(1);
  });

  it('em produção, configuração válida sobe sem lançar', async () => {
    usarEnv(ENV_VALIDO);
    await expect(chamarRegister()).resolves.toBeUndefined();
  });

  it('NODE_ENV ausente encerra a subida (não herda conveniência de dev)', async () => {
    usarEnv({ NODE_ENV: undefined, DATABASE_URL: ENV_VALIDO.DATABASE_URL });

    await expect(chamarRegister()).rejects.toThrow(/JWT_SECRET/);
    expect(codigoDoExit()).toBe(1);
  });

  it('em desenvolvimento registra os erros mas não derruba', async () => {
    usarEnv({ NODE_ENV: 'development', DATABASE_URL: ENV_VALIDO.DATABASE_URL });
    await expect(chamarRegister()).resolves.toBeUndefined();
  });

  it('durante o build não valida nada (o CI não tem segredos de produção)', async () => {
    usarEnv({ ...ENV_VALIDO, NEXT_PHASE: 'phase-production-build', JWT_SECRET: undefined });
    await expect(chamarRegister()).resolves.toBeUndefined();
  });

  it('no edge runtime não valida (a validação é do processo Node)', async () => {
    usarEnv({ ...ENV_VALIDO, NEXT_RUNTIME: 'edge', JWT_SECRET: undefined });
    await expect(chamarRegister()).resolves.toBeUndefined();
  });

  it('não lança por opcional ausente quando o resto está válido', async () => {
    // SEFAZ_EXTRA_CA_CERTS/REDIS_URL são opcionais: a partida não pode depender
    // deles. O caminho de CA é verificado em /api/ready, que é runtime Node —
    // instrumentation.ts também é compilado para o edge, onde node:fs não existe.
    usarEnv({ ...ENV_VALIDO, SEFAZ_EXTRA_CA_CERTS: undefined, REDIS_URL: undefined });
    await expect(chamarRegister()).resolves.toBeUndefined();
  });
});

describe('GET /api/health — liveness (CFG-02)', () => {
  it('responde 200 sem tocar em banco nem exigir configuração', async () => {
    usarEnv({ NODE_ENV: 'production' }); // configuração propositalmente inválida
    h.db.$queryRaw.mockRejectedValue(new Error('não deveria ser chamado'));

    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.status).toBe('ok');
    expect(typeof body.uptimeSeconds).toBe('number');
    expect(h.db.$queryRaw).not.toHaveBeenCalled();
  });
});

describe('GET /api/ready — readiness (CFG-02)', () => {
  it('pronto: 200 quando configuração e banco estão ok', async () => {
    usarEnv(ENV_VALIDO);
    h.db.$queryRaw.mockResolvedValue([{ offices: 'offices' }]);

    const { GET } = await import('@/app/api/ready/route');
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ status: 'ready', checks: { env: 'ok', database: 'ok' }, migrationsApplied: true });
  });

  it('503 quando falta configuração, nomeando as variáveis sem revelar valores', async () => {
    usarEnv({ NODE_ENV: 'production', DATABASE_URL: ENV_VALIDO.DATABASE_URL, JWT_SECRET: 'curto' });
    h.db.$queryRaw.mockResolvedValue([{ offices: 'offices' }]);

    const { GET } = await import('@/app/api/ready/route');
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;
    const bruto = JSON.stringify(body);

    expect(response.status).toBe(503);
    expect(body.status).toBe('not-ready');
    expect(body.variablesWithErrors).toEqual(expect.arrayContaining(['JWT_SECRET']));
    expect(bruto).not.toContain('curto');
    // Mensagens detalhadas só fora de produção.
    expect(body.issues).toBeUndefined();
  });

  it('503 quando o banco não responde', async () => {
    usarEnv(ENV_VALIDO);
    h.db.$queryRaw.mockRejectedValue(new Error("cannot reach database server"));

    const { GET } = await import('@/app/api/ready/route');
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: 'not-ready', checks: { env: 'ok', database: 'fail' }, migrationsApplied: false });
  });

  it('caminho de CA da SEFAZ inexistente é relatado como aviso, sem tirar a instância de rotação', async () => {
    usarEnv({ ...ENV_VALIDO, SEFAZ_EXTRA_CA_CERTS: '/caminho/que/nao/existe/icp.pem' });
    h.db.$queryRaw.mockResolvedValue([{ offices: 'offices' }]);

    const { GET } = await import('@/app/api/ready/route');
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    // Quebrar só o mTLS da SEFAZ não justifica derrubar um app que atende todo o
    // resto: por isso 200 + aviso, e não 503.
    expect(response.status).toBe(200);
    expect((body.checks as Record<string, string>).sefazCaBundle).toBe('fail');
    expect(JSON.stringify(body.warnings)).toMatch(/SEFAZ_EXTRA_CA_CERTS/);
  });

  it('sem SEFAZ_EXTRA_CA_CERTS a checagem é skipped, não fail', async () => {
    usarEnv(ENV_VALIDO);
    h.db.$queryRaw.mockResolvedValue([{ offices: 'offices' }]);

    const { GET } = await import('@/app/api/ready/route');
    const body = (await (await GET()).json()) as Record<string, unknown>;
    expect((body.checks as Record<string, string>).sefazCaBundle).toBe('skipped');
  });

  it('503 quando conecta mas as migrations não foram aplicadas', async () => {
    usarEnv(ENV_VALIDO);
    h.db.$queryRaw.mockResolvedValue([{ offices: null }]);

    const { GET } = await import('@/app/api/ready/route');
    const response = await GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ migrationsApplied: false });
    expect(String(body.databaseDetail)).toMatch(/migrations/i);
  });
});

describe('webhook de assinatura: mal configurado ≠ forjado (CFG-04)', () => {
  const corpo = JSON.stringify({ type: 'payment', data: { id: '123456' } });

  function requisicao() {
    return new Request('https://app.oficina.example.br/api/mercadopago/subscription-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: corpo,
    });
  }

  it('sem token de plataforma e sem oficina com credencial → 503, não 401', async () => {
    usarEnv({ ...ENV_VALIDO, MP_PLATFORM_ACCESS_TOKEN: undefined, MP_PLATFORM_WEBHOOK_SECRET: undefined });
    h.db.office.findMany.mockResolvedValue([] as never[]);

    const { POST } = await import('@/app/api/mercadopago/subscription-webhook/route');
    const response = await POST(requisicao() as never);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ success: false, notConfigured: true });
    expect(String(body.error)).not.toMatch(/signature/i);
  });

  it('token de plataforma placeholder também é 503 (configuração ausente)', async () => {
    usarEnv({
      ...ENV_VALIDO,
      MP_PLATFORM_ACCESS_TOKEN: 'APP_USR-xxxxxxxxxxxxxxxxxxxxxxxx',
      MP_PLATFORM_WEBHOOK_SECRET: undefined,
    });
    h.db.office.findMany.mockResolvedValue([] as never[]);

    const { POST } = await import('@/app/api/mercadopago/subscription-webhook/route');
    const response = await POST(requisicao() as never);

    expect(response.status).toBe(503);
  });

  it('com credencial de oficina e assinatura inválida → 401 continua sendo 401', async () => {
    usarEnv({ ...ENV_VALIDO, MP_PLATFORM_ACCESS_TOKEN: undefined, MP_PLATFORM_WEBHOOK_SECRET: undefined });
    h.db.office.findMany.mockResolvedValue([
      { id: 'office-A', mpAccessToken: 'APP_USR-real', mpWebhookSecret: 'segredo-real', mpUserId: '999' },
    ] as never[]);

    const { POST } = await import('@/app/api/mercadopago/subscription-webhook/route');
    const response = await POST(requisicao() as never);
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(body.error).toBe('Invalid signature');
  });
});

describe('retorno do checkout: sem redirect para localhost (CFG-03)', () => {
  it('em produção sem NEXT_PUBLIC_APP_URL responde 500 de configuração, não redirect', async () => {
    usarEnv({ ...ENV_VALIDO, NEXT_PUBLIC_APP_URL: undefined });

    const { GET } = await import('@/app/api/mercadopago/subscription-return/route');
    const response = await GET(
      new Request('https://app.oficina.example.br/api/mercadopago/subscription-return?status=success') as never
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(body.configError).toBe(true);
    expect(response.headers.get('location')).toBeNull();
  });

  it('com URL configurada, o redirect vai para o domínio real', async () => {
    usarEnv(ENV_VALIDO);

    const { GET } = await import('@/app/api/mercadopago/subscription-return/route');
    const response = await GET(
      new Request('https://app.oficina.example.br/api/mercadopago/subscription-return?status=success') as never
    );

    // Sem Authorization a rota redireciona com reason=unauthorized — o que importa
    // aqui é a base do redirect.
    const location = response.headers.get('location') || '';
    expect(location.startsWith('https://app.oficina.example.br')).toBe(true);
    expect(location).not.toContain('localhost');
  });
});

describe('.env.example corresponde ao que o código lê (CFG-06)', () => {
  it('não documenta variável que nada lê, e documenta as que lê', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const exemplo = readFileSync(resolve(__dirname, '../../../.env.example'), 'utf8');
    const documentadas = new Set(
      [...exemplo.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]+)\s*=/gm)].map((m) => m[1])
    );

    // Nada disto é lido pela aplicação — eram armadilhas para o operador.
    for (const fantasma of ['NEXTAUTH_SECRET', 'MERCADO_PAGO_ACCESS_TOKEN', 'MERCADO_PAGO_PUBLIC_KEY', 'WHATSAPP_API_TOKEN', 'WHATSAPP_API_URL']) {
      expect(documentadas.has(fantasma), `${fantasma} não deveria mais estar no .env.example`).toBe(false);
    }

    // E o que o código lê precisa estar documentado.
    for (const real of ['DATABASE_URL', 'JWT_SECRET', 'CERT_ENCRYPTION_KEY', 'NEXT_PUBLIC_APP_URL', 'PLATFORM_ADMIN_USER_IDS', 'MP_PLATFORM_ACCESS_TOKEN', 'MP_PLATFORM_WEBHOOK_SECRET', 'REDIS_URL', 'SEFAZ_EXTRA_CA_CERTS']) {
      expect(documentadas.has(real), `${real} deveria estar no .env.example`).toBe(true);
    }
  });

  it('o exemplo explica onde ficam as credenciais por oficina', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const exemplo = readFileSync(resolve(__dirname, '../../../.env.example'), 'utf8');

    expect(exemplo).toMatch(/por oficina/i);
    expect(exemplo).toMatch(/waApiToken|waApiUrl/);
    expect(exemplo).toMatch(/mpAccessToken/);
  });
});

describe('health e ready são públicos no middleware (CFG-02)', () => {
  it('as rotas estão em PUBLIC_ROUTES e fora do rate limit', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const proxy = readFileSync(resolve(__dirname, '../../proxy.ts'), 'utf8');

    expect(proxy).toContain("'/api/health',");
    expect(proxy).toContain("'/api/ready',");
    // Se não houvesse isenção, um healthcheck frequente estouraria o limite do IP
    // do orquestrador e a instância seria reiniciada em cascata.
    expect(proxy).toMatch(/HEALTH_ROUTES\s*=\s*\[[^\]]*'\/api\/health'[^\]]*'\/api\/ready'/s);
    // Comparar com a CHAMADA, não com o import no topo do arquivo.
    const isencao = proxy.indexOf('HEALTH_ROUTES.includes(pathname)');
    const limite = proxy.indexOf('await checkRateLimitAsync(');
    expect(isencao).toBeGreaterThan(-1);
    expect(limite).toBeGreaterThan(-1);
    expect(isencao).toBeLessThan(limite);
  });
});
