# Implementação — Fase 2: limites e permissões de plano no servidor

Data: 2026-11-05 · Branch: `arena/262c9bf1-kiteos` · Item 4 do plano de correções

Antes desta leva, os limites de plano existiam apenas como **exibição**: a tabela
`PLANS` estava copiada em seis rotas, `/api/subscriptions/check` calculava uso
para mostrar barras de progresso na UI, e nenhuma rota de criação consultava
esses limites. Bastava chamar a API diretamente para criar clientes, peças e
ordens de serviço acima do contratado, e para usar IA e WhatsApp em plano Free.

## O que foi implementado

### Fonte única de verdade — `src/lib/plans.ts`
- Tabela `PLANS` (FREE/PRO/PRO_PLUS/PREMIUM), `PLAN_KEYS`, `PLAN_HIERARCHY` e
  `getPlan()` centralizados. As seis cópias locais foram removidas de
  `admin/subscriptions`, `subscriptions`, `subscriptions/[id]`,
  `subscriptions/check` e `mercadopago/create-subscription`.
- `resolveEffectivePlan()` decide **qual plano vigora agora**, lendo a assinatura
  do banco. Política *fail closed* — tudo que não é explicitamente concedido vira
  FREE:

| Situação da assinatura | Plano efetivo | `reason` |
|---|---|---|
| nenhuma linha / todas deletadas | FREE | `NONE` |
| `PENDENTE` (checkout aberto, pagamento não confirmado) | FREE | `PENDENTE` |
| `CANCELADA` | FREE | `CANCELADA` |
| `TRIAL` com `trialEndDate` vencido | FREE | `TRIAL_EXPIRED` |
| `endDate` vencido | FREE | `ENDED` |
| status desconhecido | FREE | `UNKNOWN_STATUS` |
| `ATIVA`/`TRIAL` dentro do período | plano contratado | `ACTIVE` |
| `ATIVA`/`TRIAL` com período vencido, ou `INADIMPLENTE` | plano contratado + `isOverdue` | `ACTIVE` |

  A função **apenas lê**: nunca altera a assinatura, portanto é segura dentro da
  transação que cria um registro.
- `assertCanCreate(store, officeId, 'OS'|'CLIENT'|'PART')` e
  `assertFeature(store, officeId, 'aiAccess'|'whatsapp')` lançam `PlanError`
  (HTTP **402**) com `code`, `plan`, `resource`/`feature`, `current` e `max`,
  para a UI poder mostrar upgrade em vez de um erro genérico.

### Pontos de enforcement
| Rota | Regra aplicada | Onde |
|---|---|---|
| `POST /api/service-orders` | `maxOS` | dentro do `$transaction` existente, antes de qualquer escrita |
| `POST /api/clients` | `maxClients` | criação envolvida em `$transaction` com a contagem |
| `POST /api/parts` | `maxParts` | criação envolvida em `$transaction` com a contagem |
| `POST /api/ai/chat` | `aiAccess` | antes de ler dados da oficina ou gastar tokens |
| `POST /api/whatsapp/send-os` | `whatsapp` | antes de consultar a oficina ou chamar o provedor |
| `POST /api/whatsapp/send-nf` | `whatsapp` | idem |
| `POST /api/whatsapp/send-sale` | `whatsapp` | idem |
| `PUT /api/whatsapp/config` | `whatsapp` | plano Free não pode habilitar a integração |

Contagem: ordens de serviço são contadas **por período de cobrança**
(`currentPeriodStart`, ou `startDate`), como a UI já exibia; clientes e peças são
contados no total de registros não deletados.

### `GET /api/subscriptions/check` reescrito
Passou a usar `resolveEffectivePlan()`/`buildPlanStatus()`, garantindo que o que a
tela mostra é exatamente o que a API aplica. Mantém a manutenção de billing que já
fazia (provisionar FREE, marcar `INADIMPLENTE`, rebaixar trial vencido) e agora
expõe `subscribedPlan`, `effectivePlan` e `fallbackReason`. Validação de entrada
endurecida: `officeId` obrigatório, tenant do token e oficina existente.

### Correções de UI ligadas a permissão
- `admin-subscriptions.tsx`: o painel era liberado para `ADMIN`/`OWNER` de
  qualquer oficina, enquanto a API passou a exigir admin de plataforma — o
  usuário via o painel e tomava 403. Agora usa `user.isPlatformAdmin`.
- O mesmo componente tinha **hooks depois de um `return` condicional** (violação
  das Rules of Hooks, quebra quando a condição muda). Os hooks foram movidos para
  antes da tela de "Acesso Restrito" e a busca nem é disparada sem permissão.
- `apiFetch` passou a devolver também `status`, de forma aditiva, para que a UI
  possa tratar 402 (upgrade) sem mudar o contrato existente. As mensagens de
  limite já chegam ao usuário pelos toasts atuais (`res.error`).

## Defeito real encontrado pelos testes

`getPlan()` usava `value in PLANS`. Como `in` percorre a cadeia de protótipos,
`'__proto__' in PLANS` é verdadeiro e `PLANS['__proto__']` devolve
`Object.prototype` — um "plano" com `maxOS`/`maxClients`/`maxParts` `undefined`.
Com teto `undefined`, a comparação `current >= undefined` é falsa e a criação era
**liberada sem limite** (fail-open). Uma assinatura gravada com `plan`
`'__proto__'`, `'constructor'` ou `'toString'` daria acesso ilimitado.

Correções aplicadas:
- `isPlanKey()` usa `Object.prototype.hasOwnProperty.call(PLANS, value)`.
- `isLimitReached()` nega acesso quando o teto não é um número finito.
- `assertCanCreate()` lança `PlanError` se o teto não for utilizável.
- `assertFeature()` exige `=== true`, não apenas verdadeiro.

O caso está coberto em `plan-policy.test.ts`
(`cannot be tricked into unlimited access by a poisoned plan name`).

## Validação executada

| Verificação | Resultado |
|---|---|
| `npm run test:acceptance` | **94/94 testes passaram** (9 arquivos) |
| `npx tsc --noEmit --incremental false` | **0 erros** |
| `npx eslint src` | **1 erro** (pré-existente em `src/lib/sefaz/certificate.ts:198`, `require()`), 26 warnings; baseline da auditoria era 3 erros |
| Suíte de segurança já existente do produto (`src/__tests__/security`) | **22/22 passaram** — sem regressão |
| Sondas de caracterização (`audit/vitest.config.ts`) | 13 falham (defeitos corrigidos) / 5 passam — ver `STATUS-SONDAS.md` |

Novos arquivos de teste:
- `src/__tests__/acceptance/plan-policy.test.ts` (28 testes) — política de plano
  efetivo, contagem por período, limites, features, serialização de erro e o caso
  `__proto__`.
- `src/__tests__/acceptance/plan-limits.test.ts` (14 testes) — handlers reais:
  402 antes de qualquer escrita, plano pendente/cancelado tratado como FREE,
  PREMIUM ilimitado sem contar, WhatsApp/IA bloqueados sem chamar o provedor.
- `src/__tests__/acceptance/subscription-check.test.ts` (13 testes) — escopo de
  tenant, auto-provisionamento, housekeeping de billing e coerência entre o que é
  reportado e o que é aplicado.

Evidências em `audit/evidence/`: `acceptance-fase2.log`, `typecheck-fase2.log`,
`lint-src-fase2.log`, `product-security-fase2.log`, `probes-pos-fase1-2.log`.

`npm test` (suíte completa do produto) continua bloqueado neste ambiente: o
`globalSetup` roda `prisma generate`, que baixa engines de `binaries.prisma.sh`.
A suíte de segurança foi executada sem esse `globalSetup`.

Os testes usam Prisma mockado: comprovam predicados, ordem das operações e
ausência de escrita, mas **não** comprovam comportamento sob concorrência real.

## Reproduzir o typecheck offline

`prisma generate` baixa engines de `binaries.prisma.sh`, fora do allowlist deste
sandbox. O script `audit/tools/gen-prisma-types-offline.cjs` gera o client
completo acionando o próprio gerador do Prisma com `skipDownload`, `noEngine` e
`binaryPathsOverride` apontando para placeholders:

```bash
npm install --prefix /home/user/audit-tools @prisma/internals@6.19.3
node audit/tools/gen-prisma-types-offline.cjs   # ajuste o caminho do internals no script
```

Ele escreve `node_modules/.prisma/client` com o `index.d.ts` real (o tsc confere
os tipos derivados do schema de verdade). Consultas continuam impossíveis — não
há binário de engine —, por isso todo teste de banco mocka `@/lib/db`.

## Limitações conhecidas desta leva

1. ~~**TOCTOU de contagem.**~~ **RESOLVIDA no passo 1** — ver
   `IMPLEMENTACAO-BANCO-REAL.md`. A contagem já rodava na mesma transação da
   escrita, mas duas transações concorrentes ainda podiam ambas passar. Hoje
   `assertCanCreate` toma uma trava transacional por oficina
   (`pg_advisory_xact_lock(hashtextextended(officeId, 0))`) **antes** de contar,
   apenas quando o teto não é ilimitado. Provado com 12 transações concorrentes
   num PostgreSQL 17 real: exatamente 1 sucesso e 11 `PlanError`
   (`src/__tests__/integration/concurrency.test.ts`), com controle negativo
   mostrando que, sem a trava, o teto é de fato ultrapassado.
2. **Carência (`INADIMPLENTE`/período vencido) mantém os limites.** Decisão
   deliberada: bloquear a criação de OS impediria a oficina de faturar e quitar a
   dívida. Transformar carência em bloqueio após N dias é decisão de produto, não
   implementada.
3. **Sem assinatura, OS contam "desde sempre".** Para uma oficina nova dá no
   mesmo; para dado legado pode bloquear antes do esperado. O provisionamento da
   linha FREE acontece na primeira carga do painel
   (`/api/subscriptions/check`), que é o caminho normal.
4. **Upsell não automatizado na UI.** O usuário recebe a mensagem exata via toast,
   mas não há diálogo de upgrade disparado pelo 402. `apiFetch` já expõe `status`
   para permitir isso.
5. **Planos não cobrem vendas, financeiro, mecânicos, fornecedores nem
   multi-usuário.** A tabela contratual só define OS/clientes/peças/IA/WhatsApp;
   ampliar limites é decisão comercial.

## Próximos passos do plano

1. Banco real: migrations versionadas, PostgreSQL e testes de
   integração/concorrência (incluindo o contador de plano do item 1 acima).
2. Build/CI: dependência de Google Fonts no build, `start` usando bun, pipeline
   de verificação.
3. Estornos: reversão financeira e de estoque rastreável, sem apagar lançamento
   pago.
5. Fiscal: bloquear operações não homologadas e preparar testes que exigem
   certificado e credenciais reais.
