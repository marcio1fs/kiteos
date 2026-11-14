/**
 * GET /api/ready — readiness.
 *
 * PASSO 6 (CFG-02). Responde "esta instância pode receber tráfego?", verificando o
 * que o `HEALTHCHECK` antigo do Dockerfile não verificava: ele fazia
 * `wget --spider http://localhost:3000/`, e a página raiz responde 200 mesmo com
 * `DATABASE_URL` quebrado, migrations não aplicadas ou `JWT_SECRET` ausente. O
 * orquestrador marcava a instância como saudável e mandava tráfego para ela.
 *
 * Duas verificações, uma consulta só:
 * - `to_regclass('public.offices')` retorna NULL se a tabela não existe → pega
 *   tanto "banco inacessível" quanto "conectado num banco sem migrations".
 * - `readEnv()` valida configuração e devolve os nomes das variáveis com problema.
 *
 * **Não vaza segredo:** a resposta traz apenas nomes de variáveis e categorias de
 * falha. As mensagens completas vão para o log do servidor, e só entram na resposta
 * em development/test — dizer a um anônimo "JWT_SECRET está ausente" é informação
 * útil para atacar.
 *
 * Sem autenticação e sem rate limit (mesma razão de `/api/health`).
 */
import { existsSync } from 'node:fs';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { readEnv } from '@/lib/env';

export const dynamic = 'force-dynamic';

type CheckResult = 'ok' | 'fail';

export async function GET() {
  const report = readEnv();

  let database: CheckResult = 'fail';
  let databaseDetail = 'desconhecido';
  let migrationsApplied = false;
  try {
    const rows = await db.$queryRaw<Array<{ offices: string | null }>>`
      SELECT to_regclass('public.offices')::text AS offices
    `;
    migrationsApplied = Boolean(rows[0]?.offices);
    database = migrationsApplied ? 'ok' : 'fail';
    databaseDetail = migrationsApplied ? 'conectado e com migrations aplicadas' : 'conectado, mas a tabela "offices" não existe (migrations não aplicadas?)';
  } catch (error) {
    databaseDetail = error instanceof Error ? error.message : String(error);
  }

  // Verificação que precisa de sistema de arquivos: vive aqui (route handler em
  // runtime Node) e não em `instrumentation.ts`, que o Turbopack também compila
  // para o Edge Runtime, onde `node:fs` não existe.
  const caPath = report.config.sefazExtraCaCerts;
  const sefazCaBundle: CheckResult | 'skipped' = caPath
    ? existsSync(caPath)
      ? 'ok'
      : 'fail'
    : 'skipped';

  const env: CheckResult = report.ok ? 'ok' : 'fail';
  const ready = env === 'ok' && database === 'ok';

  if (!ready) {
    // Detalhe completo no log; na resposta, só o necessário para o operador.
    console.error(
      `[ready] instância não está pronta — env ${env} (${report.errors.length} erro(s)), database ${database}: ${databaseDetail}`,
      report.errors.map((e) => `${e.variable}: ${e.message}`)
    );
  }

  const body: Record<string, unknown> = {
    status: ready ? 'ready' : 'not-ready',
    checks: { env, database, sefazCaBundle },
    migrationsApplied,
    timestamp: new Date().toISOString(),
  };

  // Um caminho de CA errado quebra toda operação fiscal, mas não o resto do
  // sistema: por isso é relatado como aviso e NÃO tira a instância de rotação.
  // Marcá-la não-pronta faria o orquestrador derrubar um app que atende tudo o
  // que não é SEFAZ.
  if (sefazCaBundle === 'fail') {
    body.warnings = [
      `SEFAZ_EXTRA_CA_CERTS aponta para "${caPath}", que não existe; mTLS com a SEFAZ vai falhar por cadeia de certificados incompleta.`,
    ];
  }

  if (!ready) {
    // Nomes das variáveis problemáticas: é o que o operador precisa para agir, e
    // não revela valores.
    body.variablesWithErrors = report.errors.map((e) => e.variable);
    body.databaseDetail = databaseDetail;
    if (report.config.isDevLike) {
      body.issues = report.errors.map((e) => `${e.variable}: ${e.message}`);
    }
  }

  return NextResponse.json(body, { status: ready ? 200 : 503 });
}
