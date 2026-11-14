/**
 * Hook de instrumentação do Next.js — validação de configuração na partida.
 *
 * PASSO 6 (CFG-01). Este é o ponto que faltava: `register()` roda uma vez quando o
 * servidor sobe, antes de aceitar tráfego. Sem ele, `JWT_SECRET` ausente só
 * aparecia no primeiro login (500 na frente do cliente) e `CERT_ENCRYPTION_KEY`
 * ausente só na primeira gravação de certificado.
 *
 * Comportamento:
 * - **build** (`NEXT_PHASE=phase-production-build`): não faz nada. O build não tem
 *   segredos de produção e não deve falhar por isso — o CI roda `next build` só com
 *   `DATABASE_URL`.
 * - **edge runtime**: não faz nada (a validação é do processo Node).
 * - **development/test**: loga erros e avisos, mas não derruba — senão `next dev`
 *   não sobe para quem ainda não tem certificado configurado.
 * - **produção (incluindo NODE_ENV ausente ou "staging")**: encerra o processo com
 *   código 1 (`failStartup`). O orquestrador vê a falha e o operador recebe o nome
 *   exato da variável, em vez de um container "saudável" que responde 500.
 *
 * **Este arquivo precisa permanecer edge-safe.** O Next compila `register()` para
 * os dois runtimes, e o Turbopack o traça no bundle edge (nesta aplicação o rastro
 * passa por `api/uploads/logos/[filename]`). No edge não existe `node:fs` e `eval`
 * é proibido — as duas tentativas de checar o arquivo de CAs da SEFAZ daqui
 * falharam, uma com aviso e outra com erro de build. Verificações que precisam de
 * sistema de arquivos vivem em `GET /api/ready`, que é runtime Node.
 */
import { formatIssues, readEnv } from '@/lib/env';

/**
 * Encerra a partida quando a configuração é inválida.
 *
 * **Lançar não basta.** Verificado executando o servidor real: com erro no hook de
 * instrumentação, o Next 16 registra `Failed to prepare server` + `unhandledRejection`,
 * mantém o processo vivo e passa a responder **500 em todas as rotas** (inclusive
 * `/` e `/api/health`). Ou seja: um supervisor sem política de restart fica com um
 * zumbi servindo erro, e um com `restart: always` nunca reinicia porque o processo
 * não sai. `process.exit(1)` faz o container terminar com código não-zero, que é o
 * sinal que o orquestrador entende.
 *
 * O `throw` depois do `exit` é inalcançável em runtime; existe para que os testes
 * possam mockar `process.exit` e observar a falha sem derrubar o runner.
 */
export function failStartup(motivo: string): never {
  console.error(`[startup] encerrando: ${motivo}`);
  process.exit(1);
  throw new Error(motivo);
}

/** Fase de build do Next — durante `next build` não há segredos para validar. */
const PHASE_PRODUCTION_BUILD = 'phase-production-build';

export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === PHASE_PRODUCTION_BUILD) return;
  if (process.env.NEXT_RUNTIME === 'edge') return;

  const report = readEnv();

  for (const line of formatIssues(report.warnings)) {
    console.warn(`[startup] ${line}`);
  }
  for (const line of formatIssues(report.errors)) {
    console.error(`[startup] ${line}`);
  }

  if (report.ok) {
    console.log(
      `[startup] configuração validada (NODE_ENV=${report.config.nodeEnv}, ` +
        `MP plataforma ${report.config.mercadoPago.configured ? 'configurado' : 'não configurado'}, ` +
        `${report.config.platformAdminUserIds.length} operador(es) de plataforma)`
    );
    return;
  }

  if (report.config.isDevLike) {
    console.error(
      `[startup] ${report.errors.length} problema(s) de configuração — seguindo em ` +
        `development/test; em produção o servidor não subiria.`
    );
    return;
  }

  failStartup(
    `Configuração inválida: ${report.errors.length} variável(is) impedem a subida ` +
      `(${report.errors.map((e) => e.variable).join(', ')}). Veja as mensagens acima.`
  );
}
