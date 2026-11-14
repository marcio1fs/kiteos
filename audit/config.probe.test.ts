/**
 * Sondas de caracterização — PASSO 6: configuração e segredos.
 *
 * Convenção invertida, como nas demais sondas: **sonda que PASSA = defeito
 * reproduzido**. Depois da correção estas sondas devem FALHAR.
 *
 * Rodar: `npx vitest run --config audit/vitest.config.ts`
 *
 * Nada aqui fala com rede ou banco: `@/lib/db` é mockado e as rotas são chamadas
 * com `Request` real do padrão Web.
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  db: {
    office: { findMany: vi.fn(async () => [] as never[]), findUnique: vi.fn() },
    subscription: { findFirst: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn(async () => undefined) },
  },
}));
vi.mock('@/lib/db', () => ({ db: h.db }));

import { encryptToken } from '@/lib/token-encryption';
import { isPlatformAdmin } from '@/lib/auth';

const RAIZ = path.resolve(__dirname, '..');
const SRC = path.join(RAIZ, 'src');

/** Todos os .ts/.tsx de src/, sem os testes. */
function fontesDoProduto(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(full);
      } else if (/\.(ts|tsx)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(SRC);
  return out;
}

const ENV_ORIGINAL = { ...process.env };

/**
 * `process.env.NODE_ENV` é tipado como somente-leitura nos tipos do Node, mas as
 * sondas precisam variá-lo. Acesso por um record mutável explícito.
 */
const env: Record<string, string | undefined> = process.env as unknown as Record<string, string | undefined>;

function setNodeEnv(value: string | undefined): void {
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.db.office.findMany.mockResolvedValue([] as never[]);
});

afterEach(() => {
  // As sondas mexem em NODE_ENV/segredos; restaurar para não contaminar as outras.
  for (const key of Object.keys(env)) {
    if (!(key in ENV_ORIGINAL)) delete env[key];
  }
  for (const [key, value] of Object.entries(ENV_ORIGINAL)) env[key] = value;
});

describe('Sonda 19 (CFG-01) — não existe validação de configuração na partida', () => {
  it('o app carrega sem JWT_SECRET e sem CERT_ENCRYPTION_KEY; ninguém valida env na subida', async () => {
    delete process.env.JWT_SECRET;
    delete process.env.CERT_ENCRYPTION_KEY;

    // Nenhum ponto de entrada de startup existe: nem o hook de instrumentação do
    // Next.js, nem um módulo central de configuração.
    expect(existsSync(path.join(SRC, 'instrumentation.ts'))).toBe(false);
    expect(existsSync(path.join(SRC, 'instrumentation.node.ts'))).toBe(false);
    expect(existsSync(path.join(SRC, 'lib', 'env.ts'))).toBe(false);
    expect(existsSync(path.join(SRC, 'lib', 'config.ts'))).toBe(false);

    // Carregar os módulos não reclama: a falha só aparece no primeiro request que
    // precise assinar um token ou criptografar um certificado — em produção, na
    // frente do cliente, não na subida.
    const auth = await import('@/lib/auth');
    expect(typeof auth.requireAuth).toBe('function');
    const cert = await import('@/lib/sefaz/certificate');
    expect(typeof cert.encryptPassword).toBe('function');
  });
});

describe('Sonda 20 (CFG-02) — o healthcheck do container não verifica nada além de "/"', () => {
  it('HEALTHCHECK aponta para a raiz e não existe rota de health/ready', () => {
    const dockerfile = readFileSync(path.join(RAIZ, 'Dockerfile'), 'utf8');
    const healthcheck = dockerfile
      .split('\n')
      .filter((l) => /HEALTHCHECK|wget|curl/.test(l))
      .join(' ');

    // O container é declarado saudável porque a página raiz responde 200 — mesmo
    // com DATABASE_URL quebrado, JWT_SECRET ausente ou migrations não aplicadas.
    expect(healthcheck).toMatch(/localhost:3000\/(\s|$|")/);
    expect(healthcheck).not.toMatch(/\/api\/(health|ready|healthz|readyz)/);

    expect(existsSync(path.join(SRC, 'app', 'api', 'health', 'route.ts'))).toBe(false);
    expect(existsSync(path.join(SRC, 'app', 'api', 'ready', 'route.ts'))).toBe(false);
  });
});

describe('Sonda 21 (CFG-03) — NEXT_PUBLIC_APP_URL ausente vira localhost em produção', () => {
  it('redirect do retorno de assinatura manda o cliente para http://localhost:3000', async () => {
    setNodeEnv('production');
    delete env.NEXT_PUBLIC_APP_URL;

    const { GET } = await import('@/app/api/mercadopago/subscription-return/route');
    // Sem Authorization: a rota cai no ramo não-autenticado, que já redireciona.
    const request = new Request('https://kiteos.example.invalid/api/mercadopago/subscription-return?status=success');
    const response = await GET(request as never);

    const location = response.headers.get('location') || '';
    expect(location.startsWith('http://localhost:3000')).toBe(true);
    expect(location).not.toContain('kiteos.example.invalid');
  });

  it('as URLs de retorno e o notification_url enviados ao Mercado Pago usam o mesmo fallback', () => {
    const comFallback = fontesDoProduto().filter((f) =>
      /NEXT_PUBLIC_APP_URL \|\| 'http:\/\/localhost:3000'/.test(readFileSync(f, 'utf8'))
    );
    // back_urls (success/failure/pending), notification_url e redirects: tudo
    // derivado de um fallback silencioso, inclusive em NODE_ENV=production.
    expect(comFallback.length).toBeGreaterThanOrEqual(2);
    expect(
      comFallback.some((f) => f.includes(path.join('mercadopago', 'create-payment')))
    ).toBe(true);
  });
});

describe('Sonda 22 (CFG-04) — "está configurado?" é decidido por string-matching de placeholder', () => {
  it("a presença de 'xxxxxxxx' no token decide o comportamento, em vários lugares", () => {
    const usos = fontesDoProduto().filter((f) =>
      readFileSync(f, 'utf8').includes("includes('xxxxxxxx')")
    );
    expect(usos.length).toBeGreaterThanOrEqual(3);
    const total = fontesDoProduto().reduce(
      (n, f) => n + (readFileSync(f, 'utf8').match(/includes\('xxxxxxxx'\)/g) || []).length,
      0
    );
    expect(total).toBeGreaterThanOrEqual(5);
  });

  it('plataforma mal configurada responde 401 "Invalid signature", igual a uma requisição forjada', async () => {
    // Token de exemplo do .env.example, nunca trocado pelo operador real.
    process.env.MP_PLATFORM_ACCESS_TOKEN = 'APP_USR-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';
    delete process.env.MP_PLATFORM_WEBHOOK_SECRET;

    const { POST } = await import('@/app/api/mercadopago/subscription-webhook/route');
    const request = new Request('https://kiteos.example.invalid/api/mercadopago/subscription-webhook', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'payment', data: { id: '123456' } }),
    });
    const response = await POST(request as never);
    const body = (await response.json()) as { error?: string };

    // 401 "Invalid signature": quem opera não distingue "você esqueceu de
    // configurar o secret" de "alguém forjou um webhook".
    expect(response.status).toBe(401);
    expect(body.error).toBe('Invalid signature');
  });
});

describe('Sonda 23 (CFG-05) — segredo por oficina é gravado em texto puro fora de "production"', () => {
  it('encryptToken devolve o plaintext quando NODE_ENV não é exatamente production', () => {
    delete process.env.CERT_ENCRYPTION_KEY;

    for (const ambiente of ['staging', 'test', 'homolog', undefined] as (string | undefined)[]) {
      setNodeEnv(ambiente);

      const segredo = 'APP_USR-token-real-de-producao';
      // Sem chave de criptografia, o módulo desiste e grava em claro: um staging
      // com NODE_ENV diferente de "production" persiste segredo legível no banco.
      expect(encryptToken(segredo)).toBe(segredo);
    }
  });
});

describe('Sonda 24 (CFG-06) — .env.example documenta variáveis que o código não lê', () => {
  it('operador configura o que está no exemplo e nada acontece', () => {
    const exemplo = readFileSync(path.join(RAIZ, '.env.example'), 'utf8');
    const documentadas = new Set(
      [...exemplo.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]+)\s*=/gm)].map((m) => m[1])
    );
    const lidas = new Set<string>();
    for (const f of fontesDoProduto()) {
      for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        lidas.add(m[1]);
      }
    }

    // Sem NextAuth no projeto, sem leitor de MERCADO_PAGO_*/WHATSAPP_* em env
    // (WhatsApp é por oficina, no banco). Quem segue o exemplo acha que configurou.
    const documentadasInuteis = [...documentadas].filter(
      (v) => !lidas.has(v) && !['DATABASE_URL', 'SHADOW_DATABASE_URL'].includes(v)
    );
    expect(documentadasInuteis).toEqual(
      expect.arrayContaining(['NEXTAUTH_SECRET', 'MERCADO_PAGO_ACCESS_TOKEN', 'WHATSAPP_API_TOKEN'])
    );

    // E o que o código realmente lê não está documentado.
    expect(documentadas.has('NEXT_PUBLIC_APP_URL')).toBe(false);
    expect(lidas.has('NEXT_PUBLIC_APP_URL')).toBe(true);
    expect(documentadas.has('MP_PLATFORM_ACCESS_TOKEN')).toBe(false);
    expect(lidas.has('MP_PLATFORM_ACCESS_TOKEN')).toBe(true);
  });
});

describe('Sonda 25 (CFG-07) — PLATFORM_ADMIN_USER_IDS mal formado trava a plataforma em silêncio', () => {
  it('separador errado e valores inválidos são aceitos sem nenhum aviso', () => {
    // Operador usa ";" (ou ponto e vírgula copiado de uma planilha) em vez de ",".
    process.env.PLATFORM_ADMIN_USER_IDS = 'user-1;user-2';
    expect(isPlatformAdmin('user-1')).toBe(false);

    // Separador trocado por espaço: dois ids viram um só, que não existe.
    process.env.PLATFORM_ADMIN_USER_IDS = 'user-1 user-2';
    expect(isPlatformAdmin('user-1')).toBe(false);
    expect(isPlatformAdmin('user-2')).toBe(false);

    // Vazio: ninguém é operador de plataforma. É o default seguro, mas é
    // indistinguível de "esqueci de configurar".
    process.env.PLATFORM_ADMIN_USER_IDS = '';
    expect(isPlatformAdmin('user-1')).toBe(false);

    // O defeito não é nenhum destes resultados isolados — é que NENHUM deles
    // lança, loga ou aparece em qualquer superfície: /api/admin/* fica
    // inacessível para todos os operadores e não há sinal de que foi erro de
    // configuração. Falha em silêncio, na partida, sem verificação.
    expect(() => isPlatformAdmin('user-1')).not.toThrow();
    process.env.PLATFORM_ADMIN_USER_IDS = '';
    expect(() => isPlatformAdmin('user-1')).not.toThrow();
    expect(isPlatformAdmin('user-1')).toBe(false);
  });
});
