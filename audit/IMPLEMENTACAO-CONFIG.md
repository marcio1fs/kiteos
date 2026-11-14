# Implementação — Passo 6: configuração e segredos

> **Escopo atacado:** achados `CFG-01` a `CFG-07`, caracterizados pelas sondas
> 19–25 em `audit/config.probe.test.ts`.
>
> **Estado:** implementado e executado — inclusive com o servidor real de pé, não
> só em teste unitário. CI run
> [`43545574204`](https://github.com/marcio1fs/kiteos/actions/runs/43545574204)
> (commit `f98991c`): 4 jobs `success`, **aceitação 237/237**, **integração 24/24
> em PostgreSQL 17**, typecheck 0 erros, lint 0 erros, build offline `exit 0`,
> imagem `node v22.23.5 | /app 156.8M`, gate de drift sem migration nova.
> Evidências: `audit/evidence/servidor-passo6.log` (servidor executado),
> `audit/evidence/ci-run-43545574204.log`, `audit/evidence/probes-pos-passo6.log`,
> `audit/evidence/testes-locais-passo6.log`.
>
> **Nenhuma migration nova foi necessária** — o passo é inteiro de configuração,
> contrato de partida e superfícies de diagnóstico.

---

## 1. O defeito de fundo: o sistema descobria a própria configuração tarde demais

Nenhum dos problemas deste passo era "falta uma variável". Era **quando** a falta
aparecia. Cada biblioteca lia `process.env` por conta própria e falhava no primeiro
request que precisasse dela:

| Variável ausente | Onde aparecia antes | Consequência |
| --- | --- | --- |
| `JWT_SECRET` | primeira assinatura de token | 500 no login, na frente do cliente |
| `CERT_ENCRYPTION_KEY` | primeira gravação de certificado | erro obscuro de criptografia |
| `NEXT_PUBLIC_APP_URL` | **em lugar nenhum** | fallback silencioso para `localhost:3000` |
| `MP_PLATFORM_WEBHOOK_SECRET` | **em lugar nenhum** | 401 "Invalid signature" para webhook legítimo |
| `PLATFORM_ADMIN_USER_IDS` mal formado | **em lugar nenhum** | `/api/admin/*` recusa todos, sem sinal |

E o container era declarado **saudável** o tempo todo: o `HEALTHCHECK` fazia
`wget --spider http://localhost:3000/`, e a raiz responde 200 independentemente de
banco, segredos e migrations.

O segundo defeito de fundo é um padrão repetido: **`NODE_ENV !== 'production'` era
usado como licença para ser inseguro.** Staging, "homolog", ou um container que
simplesmente não define `NODE_ENV`, herdavam o comportamento de desenvolvimento —
inclusive gravar token de pagamento em texto puro.

---

## 2. `src/lib/env.ts` — única fonte de verdade

Quatro regras de projeto, todas motivadas por algo que quebrou durante a
implementação:

1. **Não lança ao importar.** `readEnv()` coleta problemas e devolve um relatório;
   só `getEnv()`/`validateEnvOrThrow()`/`requireAppUrl()` lançam. Testes precisam
   montar cenário incompleto de propósito.
2. **Não guarda cache.** `process.env` é relido a cada chamada. Barato (só strings)
   e evita snapshot congelado — o mesmo erro do `const APP_URL` em escopo de módulo
   descrito na seção 5.
3. **Nenhum import de `node:`.** O middleware (`src/proxy.ts`) roda em edge runtime
   e usa este módulo. A checagem de arquivo que precisava de `node:fs` foi para
   `/api/ready` (seção 4) depois de duas tentativas frustradas (seção 10).
4. **`NODE_ENV` ausente ou estranho é produção.** `staging`, `homolog`, `prod`,
   `Producao` ou ausente → `nodeEnv: 'production'`, com aviso. Comportamento
   inseguro passa a ser opt-in explícito, nunca consequência de um valor que o
   orquestrador esqueceu.

### Regras aplicadas

| Variável | Regra | Nível |
| --- | --- | --- |
| `JWT_SECRET` | obrigatório, ≥ 32 caracteres, não pode ser valor de exemplo | erro (em qualquer ambiente) |
| `DATABASE_URL` | obrigatório, `postgres://` ou `postgresql://` | erro |
| `CERT_ENCRYPTION_KEY` | obrigatório, ≥ 32 caracteres, não placeholder | erro em produção, aviso em dev/test |
| `NEXT_PUBLIC_APP_URL` | obrigatório em produção; absoluto; `https://`; não localhost/127.x/`.internal`/`.local`/IP privado; normalizado para a origem | erro |
| `MP_PLATFORM_WEBHOOK_SECRET` | obrigatório **quando** `MP_PLATFORM_ACCESS_TOKEN` é real | erro |
| `MP_PLATFORM_ACCESS_TOKEN` | opcional; placeholder é ignorado | aviso se placeholder |
| `REDIS_URL` | opcional; `redis://` ou `rediss://` | erro se esquema inválido |
| `PLATFORM_ADMIN_USER_IDS` | opcional; vazio = ninguém é operador | aviso (lockout invisível) |
| `ALLOW_INSECURE_PLAINTEXT_TOKENS` | só dev/test | erro em produção |
| `NODE_ENV` | ausente/desconhecido → produção | aviso |

`isPlaceholderSecret()` reconhece os valores literais do `.env.example`
(`your-jwt-secret-here`, `your-encryption-key-here`, `your-mp-access-token`, …),
`x` repetido seis vezes ou mais, `<...>`, `insert here`, `changeme` e genéricos
como `secret`/`senha`/`todo`.

**Erros nunca ecoam o valor do segredo** — só o nome da variável e, quando útil, o
comprimento. `ConfigError` monta a mensagem a partir dos nomes. Há teste para isso
(aceitação e integração).

---

## 3. Partida: `src/instrumentation.ts` (CFG-01)

`register()` roda uma vez na subida, antes de aceitar tráfego. Loga todos os avisos
e erros e, em produção com erro, **encerra o processo**.

Pula em dois casos, ambos deliberados:

- `NEXT_PHASE=phase-production-build` — o build não tem segredos de produção. O CI
  roda `next build` só com `DATABASE_URL`; sem este guard o build quebraria.
- `NEXT_RUNTIME=edge` — a validação é do processo Node.

### Lançar não bastava: o achado que só apareceu executando

A primeira versão fazia `throw new Error(...)` no fim do `register()`. **Executando
o servidor real**, o resultado foi:

```
✓ Ready in 0ms
[startup] [ERROR] JWT_SECRET: ...
Failed to prepare server Error: An error occurred while loading instrumentation hook: ...
⨯ unhandledRejection:  Error: An error occurred while loading instrumentation hook: ...
```

…e o processo **continuou vivo**, respondendo **500 em todas as rotas** — `/`,
`/api/health` e `/api/ready` inclusive (verificado com `curl`, processo confirmado
vivo por `kill -0`). É o pior dos estados: um supervisor sem política de restart
fica com um zumbi servindo erro, e um com `restart: always` **nunca reinicia,
porque o processo não sai**.

Por isso `failStartup()` chama `process.exit(1)` antes do `throw` (que fica como
caminho observável para os testes, que mockam `process.exit`). Verificado de novo
com o servidor real:

```
$ NODE_ENV=production DATABASE_URL=postgresql://... node server.js   # sem segredos
código de saída: 1
[startup] [ERROR] JWT_SECRET: JWT_SECRET é obrigatório: ...
[startup] [ERROR] CERT_ENCRYPTION_KEY: ... obrigatório em produção: ...
[startup] [ERROR] NEXT_PUBLIC_APP_URL: ... obrigatório em produção: ...
[startup] encerrando: Configuração inválida: 3 variável(is) impedem a subida
          (JWT_SECRET, CERT_ENCRYPTION_KEY, NEXT_PUBLIC_APP_URL).
```

Em development/test os erros são logados mas não derrubam a subida — senão
`next dev` não serve para quem está começando sem certificado configurado.

---

## 4. `/api/health` e `/api/ready` + HEALTHCHECK (CFG-02)

Duas rotas novas, ambas públicas (em `PUBLIC_ROUTES`) e **fora do rate limit**:
orquestradores chamam de um único IP em intervalo fixo, e limitar healthcheck faz a
instância ser marcada não-saudável e reiniciada em cascata.

- **`GET /api/health`** — liveness pura. Não toca em banco nem em configuração, de
  propósito: liveness que depende de DB faz o orquestrador **reiniciar** o container
  durante uma indisponibilidade do banco, transformando queda parcial em queda total.
- **`GET /api/ready`** — readiness. Valida configuração e faz **uma** consulta ao
  banco: `SELECT to_regclass('public.offices')::text`. Isso pega dois estados com
  uma query só: banco inacessível **e** "conectado num banco sem migrations"
  (`to_regclass` devolve NULL). Responde 503 com `checks`, `migrationsApplied`,
  nomes das variáveis problemáticas e o detalhe do banco.

**Não vaza segredo:** nomes de variáveis e categorias de falha na resposta;
mensagens completas só no log do servidor e, na resposta, apenas em dev/test. Dizer
a um anônimo "JWT_SECRET está ausente" é informação útil para atacar.

Um terceiro check, `sefazCaBundle`, verifica se o arquivo de `SEFAZ_EXTRA_CA_CERTS`
existe. Ele é relatado como **aviso** e não tira a instância de rotação: um caminho
errado quebra toda operação fiscal, mas não o resto do sistema, e marcar não-pronta
uma instância que atende tudo o que não é SEFAZ seria pior.

`Dockerfile`:

```dockerfile
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/ready || exit 1
```

`--start-period` subiu de 5s para 20s porque agora o check espera o banco. O
comentário no Dockerfile documenta o mapeamento para Kubernetes
(`livenessProbe=/api/health`, `readinessProbe=/api/ready`).

### Executado: o que o healthcheck antigo não via

Servidor real de pé em produção, configuração válida, **banco fora do ar**:

```
GET /                -> 200   <- o que o HEALTHCHECK antigo media
GET /api/health      -> 200   (liveness: processo de pé)
GET /api/ready       -> 503   {"status":"not-ready","checks":{"env":"ok","database":"fail",...}}
```

A leitura honesta desta evidência está em `audit/evidence/servidor-passo6.log`: o
*texto* de `databaseDetail` no sandbox é artefato — o Prisma Client local é gerado
sem engine binária (`binaries.prisma.sh` fora da allowlist), então a mensagem é
sobre protocolo `prisma://` em vez de "não consegui conectar". O **comportamento**
qualquer erro de banco → `database: fail` → 503 é o contrato, e o caminho positivo
(banco real migrado → 200; tabela ausente → 503 com `migrationsApplied: false`; e
volta a 200) é verificado no CI por `src/__tests__/integration/readiness.test.ts`
contra PostgreSQL 17, onde `prisma generate` roda de verdade. **Os 4 testes
passaram no run `43545574204`.**

---

## 5. URL pública sem fallback para localhost (CFG-03)

`process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'` aparecia em quatro
rotas, alimentando:

- `back_urls.success/failure/pending` e `notification_url` enviados ao Mercado Pago;
- redirects de retorno do checkout (`subscription-return`, três pontos);
- `create-subscription`, onde era um **`const` em escopo de módulo** — o pior caso:
  avaliado no import e, por ser `NEXT_PUBLIC_*`, inlined no build. Nem corrigir o
  ambiente em runtime adiantaria.

Em produção, `NEXT_PUBLIC_APP_URL` ausente significava mandar o Mercado Pago chamar
`http://localhost:3000/api/mercadopago/webhook` e redirecionar o cliente pagante
para `http://localhost:3000?mp_return=...`. Silenciosamente: nada logava, nada
falhava, o dinheiro apenas não conciliava.

Agora `requireAppUrl()` é chamado **por request** e lança em produção. Em
`subscription-return`, onde lançar dentro do `catch` não é opção, `redirectBase()`
devolve `null` e a rota responde 500 com `configError: true` em vez de redirecionar
para lugar nenhum.

---

## 6. Mercado Pago: configuração ausente ≠ requisição forjada (CFG-04)

Duas correções distintas.

**a) Fim do string-matching de placeholder.** Cinco ocorrências de
`token.includes('xxxxxxxx')` decidiam se a integração de plataforma estava
configurada, com semânticas divergentes por rota. Um token colado do `.env.example`
em outro formato, ou qualquer placeholder diferente daquele padrão exato, era
tratado como token real. Agora `readEnv().config.mercadoPago` resolve uma vez:
`configured`, `accessToken`, `webhookSecret`, `placeholderDetected`, `sandbox`.

O default de sandbox foi preservado de propósito: sem token de plataforma vale
`office.mpSandbox ?? true` — nunca cobrar dinheiro real por omissão.

**b) O webhook de assinatura distinguia mal os dois fracassos.** Com token
placeholder e nenhuma oficina com credencial, a rota caía no laço das oficinas,
não autenticava nada e respondia **`401 Invalid signature`**. Ou seja: o operador
que esqueceu o secret via "assinatura inválida" e ia procurar um atacante onde
havia `.env` incompleto. Agora:

| Estado | Resposta |
| --- | --- |
| Plataforma configurada, assinatura inválida | `401 Invalid signature` |
| Plataforma configurada sem secret | `503` + `notConfigured: true` |
| Sem plataforma **e** sem nenhuma oficina com credencial | `503 "Mercado Pago não configurado"` + `notConfigured: true` |
| Oficina com credencial, assinatura inválida | `401 Invalid signature` (como antes) |

---

## 7. Segredos por oficina nunca mais em texto puro (CFG-05)

`encryptToken()` protegia `mpAccessToken`, `mpRefreshToken`, `mpWebhookSecret`,
`waApiToken` e `waWebhookSecret`. O fallback era:

```ts
if (process.env.NODE_ENV === 'production') throw error;
console.warn('... Storing as plaintext.');
return plaintext;   // ← gravado no banco, legível
```

Qualquer `NODE_ENV` que não fosse exatamente `"production"` — staging, homolog, um
container que não define a variável — **persistia token de pagamento legível**, com
apenas um `console.warn` que ninguém lê. E o teste existente documentava isso como
"graceful degradation", aceitando os dois desfechos.

Agora lança, e a única saída é opt-in explícito: `ALLOW_INSECURE_PLAINTEXT_TOKENS=true`,
que `readEnv()` **recusa em produção** (vira erro de partida). O teste de segurança
foi reescrito para exigir o comportamento novo, incluindo os casos `staging`,
`homolog` e `NODE_ENV` ausente.

Registros antigos em plaintext continuam **legíveis** (`decryptToken` sem prefixo
`ENC:` devolve o valor) para não inutilizar dados existentes — mas nada mais produz
esse formato.

---

## 8. `.env.example` correspondia a um sistema que não existe (CFG-06)

Conferido por script (e agora por teste): cinco variáveis documentadas **não são
lidas por nada** — `NEXTAUTH_SECRET` (não há NextAuth no projeto),
`MERCADO_PAGO_ACCESS_TOKEN`, `MERCADO_PAGO_PUBLIC_KEY`, `WHATSAPP_API_URL`,
`WHATSAPP_API_TOKEN`. E duas lidas **não estavam documentadas**:
`NEXT_PUBLIC_APP_URL` e `MP_PLATFORM_ACCESS_TOKEN`.

O efeito prático: o operador seguia o exemplo, preenchia `MERCADO_PAGO_ACCESS_TOKEN`
e o Mercado Pago continuava desconfigurado (as credenciais de pagamento são **por
oficina, no banco**); e esquecia justamente a variável que, ausente, mandava os
callbacks de pagamento para localhost.

Reescrito com apenas o que `readEnv()` conhece, agrupado por obrigatoriedade, com o
comando de geração de segredo, e com um parágrafo explicando onde ficam as
credenciais por oficina (colunas `mpAccessToken`/`mpWebhookSecret` e
`waApiUrl`/`waApiToken`/`waInstance`, editáveis na tela de configurações).

---

## 9. Operadores de plataforma (CFG-07)

`isPlatformAdmin()` fazia `split(',')` e nada mais. Um `;` no lugar da vírgula — ou
ids colados de planilha, separados por espaço — resultava em **nenhum** operador de
plataforma, com `/api/admin/*` recusando todo mundo em 403, sem erro, sem log, sem
nenhuma superfície onde isso aparecesse.

`parsePlatformAdminIds()` agora:

- usa vírgula como separador canônico, com trim e dedupe;
- se algum "id" resultante ainda contém `;` ou espaço, **reinterpreta** com o
  conjunto amplo `[,;\s]+` em vez de perder o operador, e marca
  `usedFallbackSeparator` → aviso no log de partida;
- valor vazio continua não dando acesso a ninguém (default seguro), mas agora gera
  aviso explícito de lockout.

Durante a implementação uma suposição minha foi derrubada pelos próprios testes: eu
esperava que `'user-1,\nuser-2'` perdesse o segundo id. Não perde — `.trim()` já
remove a quebra de linha. A sonda foi corrigida para o caso que é defeito real
(`;` e espaço), em vez de manter uma afirmação falsa.

---

## 10. Duas tentativas que falharam, e o que elas ensinaram

Registrado porque muda o desenho, não só o código:

1. **`await import('node:fs')` em `instrumentation.ts`** → build com aviso:
   *"A Node.js module is loaded ('node:fs') which is not supported in the Edge
   Runtime."* O Next compila `register()` para os dois runtimes, e o Turbopack
   traça o arquivo no bundle edge (nesta aplicação o rastro passa por
   `api/uploads/logos/[filename]`).
2. **`eval('require')('node:fs')`** — o truque que `src/lib/redis.ts` já usa —
   → **build falhou**: *"Dynamic Code Evaluation not allowed in Edge Runtime."*
   `redis.ts` sobrevive porque não entra no rastro edge; `instrumentation.ts` entra.

Conclusão: `instrumentation.ts` precisa ser estritamente puro. A checagem do arquivo
de CAs mudou para `GET /api/ready` (route handler em runtime Node), onde `node:fs`
é legítimo. O arquivo carrega um comentário dizendo isso, para a próxima pessoa não
repetir as duas tentativas.

Um terceiro erro meu, este de teste: a primeira versão da asserção de rate limit
comparava `indexOf('HEALTH_ROUTES.includes(pathname)')` com
`indexOf('checkRateLimitAsync')` — e este último aparece primeiro no **import** do
topo do arquivo, não na chamada. O teste falhou apontando a ordem errada; corrigido
para comparar com `await checkRateLimitAsync(`.

---

## 11. Testes e execução real

**Novos:**

- `src/__tests__/acceptance/config-env.test.ts` — **65 testes**: configuração
  válida; cada obrigatória ausente nomeada; segredo curto/exemplo/curto demais;
  `DATABASE_URL` não-Postgres; mensagem que não ecoa segredo; `NODE_ENV`
  `staging`/`homolog`/`prod`/ausente tratados como produção; URL pública (ausente,
  localhost, 127.0.0.1, `.internal`, `.local`, IP privado, `http://`, inválida,
  normalização de origem, default em dev); `isPlaceholderSecret` em 11 casos;
  Mercado Pago (placeholder ignorado com aviso, token real sem secret, sandbox por
  `TEST-`, secret órfão); `parsePlatformAdminIds` (vírgula, `;`, espaço, vazio,
  dedupe) e aviso de lockout; `REDIS_URL`; `ALLOW_INSECURE_PLAINTEXT_TOKENS`;
  `register()` (produção encerra com código 1, produção válida sobe, `NODE_ENV`
  ausente encerra, dev não derruba, build e edge pulam); `/api/health` 200 sem
  tocar em banco; `/api/ready` 200/503 nos quatro estados + CA da SEFAZ; webhook de
  assinatura 503 × 401; redirect sem localhost; `.env.example` sem fantasmas e com
  as reais; rotas de health públicas e isentas de rate limit.
- `src/__tests__/integration/readiness.test.ts` — **4 testes** contra PostgreSQL
  real: banco migrado → 200; tabela `offices` renomeada → 503 com
  `migrationsApplied: false`; restaurada → 200 de novo; segredo inválido não vaza
  na resposta. A renomeação (em vez de `DROP SCHEMA`) mantém as conexões do pool
  válidas para exercitar exatamente o ramo "conectado sem migrations".
- `audit/config.probe.test.ts` — **9 sondas** (19–25) de caracterização.
- `src/__tests__/security/security-regression.test.ts` — bloco de criptografia de
  token reescrito: de "aceita os dois desfechos" para exigir criptografia real e
  lançar sem chave (5 testes → 9).

**Verificação de mutação.** Oito quebras de propósito, todas capturadas
(arquivos restaurados em seguida):

| Mutação | Testes que falharam |
| --- | --- |
| `NODE_ENV` ausente voltar a ser `development` | 20 |
| Aceitar localhost como URL pública em produção | 3 |
| Token MP sem secret virar só aviso | 1 |
| Placeholder voltar a contar como configurado | 1 |
| `instrumentation.ts` sem `process.exit` | 2 |
| `/api/ready` afirmar sempre `migrationsApplied` | 1 |
| `encryptToken` devolver plaintext de novo | 3 |
| Webhook voltar ao 401 quando nada está configurado | 2 |

**Sondas:** as 9 novas (19–25) **passaram a falhar** — pela convenção invertida,
defeitos corrigidos. Placar geral: **26 falham / 1 passa**, e a que passa continua
sendo a sonda obsoleta do webhook do Mercado Pago. Evidência:
`audit/evidence/probes-pos-passo6.log`.

| Verificação | Onde | Resultado |
| --- | --- | --- |
| `npm run typecheck` | sandbox | exit 0 |
| `npm run lint` | sandbox | 0 erros / 26 warnings (baseline, sem warning novo) |
| `npm run test:acceptance` | sandbox | **237/237** em 15 arquivos |
| `npx vitest run src/__tests__/` | sandbox | **320/320** em 22 arquivos |
| `npm run build` | sandbox, sem segredos (como o CI) | exit 0; 1 warning pré-existente do file tracer |
| Servidor real, sem segredos | sandbox | **exit 1**, nomeando as 3 variáveis |
| Servidor real, banco fora do ar | sandbox | `/` 200, `/api/health` 200, `/api/ready` **503** |
| Aceitação | CI `43545574204` | **237/237** |
| Integração PostgreSQL 17 | CI `43545574204` | **24/24** (4 novos) |
| Build / imagem Docker | CI `43545574204` | `success`; `node v22.23.5 \| /app 156.8M` |
| Gate de drift | CI `43545574204` | `success` — **sem migration nova** |

---

## 12. O que **não** foi validado — e por quê

- **Caminho positivo do `/api/ready` no sandbox.** O Prisma Client local não tem
  engine binária, então não há como conectar a um banco daqui. Coberto no CI
  (24/24) contra PostgreSQL 17 real.
- **Restart por orquestrador.** Verifiquei que o processo sai com código 1 e que o
  `HEALTHCHECK` aponta para `/api/ready`; **não** observei Docker/Kubernetes
  reagindo (sem Docker neste sandbox). A reação é inferida do contrato
  (`wget --spider` falha em 503; código de saída 1), não observada.
- **Mercado Pago real.** Nenhuma chamada à API do MP foi feita. As mudanças são de
  decisão local (qual token usar, qual status devolver) e não de protocolo.
- **Rotação de `CERT_ENCRYPTION_KEY`.** Não existe: trocar a chave invalida todos
  os segredos de oficina gravados. Segue aberto (seção 13).
- **Segredos já gravados em texto puro.** Este passo impede novos; **não** migra os
  existentes. Um banco que já tenha tokens em plaintext continua com eles até serem
  regravados pela tela de configurações.

---

## 13. Arquivos

**Novos:** `src/lib/env.ts` · `src/instrumentation.ts` ·
`src/app/api/health/route.ts` · `src/app/api/ready/route.ts` ·
`src/__tests__/acceptance/config-env.test.ts` ·
`src/__tests__/integration/readiness.test.ts` · `audit/config.probe.test.ts`

**Modificados:** `src/lib/auth.ts` (segredo e operadores via `env.ts`) ·
`src/lib/sefaz/certificate.ts` (chave via `env.ts`) ·
`src/lib/token-encryption.ts` (fim do plaintext silencioso) ·
`src/proxy.ts` (health/ready públicos e sem rate limit) ·
`src/app/api/mercadopago/{create-payment,create-subscription,subscription-return,subscription-webhook}/route.ts` ·
`Dockerfile` (HEALTHCHECK → `/api/ready`) · `.env.example` (reescrito) ·
`src/__tests__/security/security-regression.test.ts`

## 14. O que continua aberto

- **Rotação de `CERT_ENCRYPTION_KEY`** e **migração dos segredos já gravados em
  texto puro** (nenhuma das duas existe hoje).
- **`NEXT_PUBLIC_*` é inlined no build.** Trocar `NEXT_PUBLIC_APP_URL` em runtime
  exige rebuild; a validação na partida pega o valor errado, mas não resolve o caso
  de quem quer um build único para vários ambientes.
- **OPS-06** — rate limit e fila de importação continuam em memória: não funcionam
  com múltiplas instâncias. `REDIS_URL` agora é validado, mas o rate limit só o usa
  se `ioredis` estiver instalado.
- **Nenhum segredo por oficina é rotacionável** pela aplicação (MP, WhatsApp):
  trocar exige editar na tela, e não há auditoria de quem trocou.
- FISC-05/06/07/09/10/11 e a fila de importação persistente seguem abertos do
  passo 5 (`audit/IMPLEMENTACAO-FISCAL.md`, seção 12).

---

## Roadmap

Com este passo, **todos os sete passos numerados do relatório foram atacados**.
Fase 0 ✅ · Fase 1 ✅ · passo 1 (banco real) ✅ · passo 2 (build) ✅ ·
passo 3 (estornos) ✅ · passo 4 (planos) ✅ · passo 5 (fiscal — no critério
"nenhum status fiscal fictício") ✅ · passo 6 (configuração/segredos) ✅.

Os critérios que **dependem de terceiros** continuam abertos e não podem ser
declarados concluídos daqui: documentos autorizados pelo órgão (homologação com
prefeitura/SEFAZ e certificado A1), SPED aceito no PVA (contador), e a fase 3 do
relatório (operação/LGPD: backup/restore testado, filas persistentes, `npm audit`
sem critical/high, consentimento e retenção).
