import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { DATABASE_URL, createPool, resetDatabaseWithMigrations } from './helpers/pg';

/**
 * PASSO 6 (CFG-02) — `GET /api/ready` contra PostgreSQL real.
 *
 * Por que isto é teste de integração e não de aceitação: a rota pergunta ao banco
 * se as migrations foram aplicadas (`to_regclass('public.offices')`). Com o client
 * mockado só se pode afirmar que a rota repassa o resultado; aqui se afirma o
 * resultado de verdade, nos três estados que importam numa implantação:
 *
 *   1. banco migrado            → 200 ready
 *   2. banco sem migrations     → 503 not-ready (o estado que o HEALTHCHECK antigo
 *                                  não via: `wget --spider /` respondia 200)
 *   3. migrations aplicadas     → volta a 200 (readiness não fica travada)
 *
 * Precisa de PrismaClient com engine binária, então pula de forma limpa sem
 * DATABASE_URL — e falha alto se DATABASE_URL existir e o client não carregar,
 * porque CI verde sem testar nada é o pior resultado possível.
 */
const readyRoute = DATABASE_URL ? await import('@/app/api/ready/route').catch(() => null) : null;

if (DATABASE_URL && !readyRoute) {
  throw new Error(
    'DATABASE_URL está definido mas a rota /api/ready não carregou; o teste de readiness não pode ser pulado em silêncio.'
  );
}
if (!DATABASE_URL) {
  console.warn('[integration] DATABASE_URL ausente — testes de readiness pulados.');
}

const describeDb = readyRoute ? describe : describe.skip;

describeDb('GET /api/ready contra PostgreSQL real', () => {
  let pool: pg.Pool;
  const envSalvo: Record<string, string | undefined> = {};

  /** Configuração válida, para isolar o resultado da checagem de banco. */
  function usarEnvValida() {
    for (const key of ['JWT_SECRET', 'CERT_ENCRYPTION_KEY', 'NEXT_PUBLIC_APP_URL', 'PLATFORM_ADMIN_USER_IDS']) {
      envSalvo[key] = process.env[key];
    }
    process.env.JWT_SECRET = 'segredo-de-integracao-com-mais-de-32-caracteres';
    process.env.CERT_ENCRYPTION_KEY = 'chave-de-integracao-com-mais-de-32-caracteres';
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.oficina.example.br';
    process.env.PLATFORM_ADMIN_USER_IDS = 'user-1';
  }

  beforeAll(async () => {
    pool = createPool(5);
    usarEnvValida();
    await resetDatabaseWithMigrations(pool);
  });

  afterAll(async () => {
    // Devolve o schema migrado: os outros arquivos de integração rodam em
    // sequência e cada um faz o próprio reset, mas não custa deixar limpo.
    await resetDatabaseWithMigrations(pool).catch(() => undefined);
    for (const [key, value] of Object.entries(envSalvo)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await pool.end();
  });

  async function chamarReady() {
    const response = await readyRoute!.GET();
    return { status: response.status, body: (await response.json()) as Record<string, any> };
  }

  it('200 ready quando o banco está migrado', async () => {
    const { status, body } = await chamarReady();

    expect(status).toBe(200);
    expect(body.status).toBe('ready');
    expect(body.checks).toMatchObject({ env: 'ok', database: 'ok' });
    expect(body.migrationsApplied).toBe(true);
  });

  it('503 not-ready quando o banco existe mas não tem migrations', async () => {
    // O estado que o HEALTHCHECK antigo declarava saudável: o processo atende,
    // `GET /` responde 200, e nenhuma query de negócio funciona.
    //
    // Renomear só a tabela (em vez de DROP SCHEMA) mantém as conexões do pool
    // válidas, então `to_regclass` devolve NULL e o teste exercita exatamente o
    // ramo "conectado, mas sem migrations" — com DROP SCHEMA o Prisma poderia
    // lançar erro de conexão e o teste passaria pelo motivo errado.
    await pool.query('ALTER TABLE offices RENAME TO offices_readiness_backup');
    try {
      const { status, body } = await chamarReady();

      expect(status).toBe(503);
      expect(body.status).toBe('not-ready');
      expect(body.checks).toMatchObject({ env: 'ok', database: 'fail' });
      expect(body.migrationsApplied).toBe(false);
      expect(String(body.databaseDetail)).toMatch(/migrations/i);
    } finally {
      await pool.query('ALTER TABLE offices_readiness_backup RENAME TO offices');
    }
  });

  it('volta a 200 depois que o schema está completo de novo', async () => {
    const { status, body } = await chamarReady();

    expect(status).toBe(200);
    expect(body.migrationsApplied).toBe(true);
  });

  it('não revela valor de segredo na resposta, mesmo com configuração inválida', async () => {
    // /api/ready é público. Com um segredo curto e reconhecível, a resposta precisa
    // nomear a variável (é o que o operador usa para agir) sem ecoar o valor.
    const segredo = 'curto123';
    process.env.JWT_SECRET = segredo;
    try {
      const { status, body } = await chamarReady();
      const bruto = JSON.stringify(body);

      expect(status).toBe(503);
      expect(body.variablesWithErrors).toContain('JWT_SECRET');
      expect(bruto).not.toContain(segredo);
    } finally {
      process.env.JWT_SECRET = 'segredo-de-integracao-com-mais-de-32-caracteres';
    }
  });
});
