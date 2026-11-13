# Implementação — Passo 1: banco real (migrations, PostgreSQL, concorrência)

Escopo: item **1** do `RELATORIO-AUDITORIA.md` ("Banco real: migrations versionadas, subir
PostgreSQL e rodar testes de integração/concorrência"), conforme escolha do usuário ("sim 1").
Nenhum outro item do roadmap foi tocado.

Estado: **implementado e executado** neste sandbox contra um PostgreSQL 17.11 real. As
limitações do ambiente — o que **não** pôde ser validado aqui — estão listadas na seção 6.

---

## 1. O que foi entregue

| Arquivo | Papel |
| --- | --- |
| `prisma/migrations/0_init/migration.sql` | Baseline versionada: 48.485 bytes, 1.416 linhas, 36 `CREATE TABLE`, 135 índices, 59 `ADD CONSTRAINT` (+ PKs/unique inline = 95 constraints no total). |
| `prisma/migrations/migration_lock.toml` | `provider = "postgresql"`. |
| `src/lib/plans.ts` | **TOCTOU eliminado**: `lockOfficeForLimitCheck()` + chamada em `assertCanCreate`. |
| `vitest.integration.config.ts` | Configuração da suíte de integração (sequencial, `pool: 'forks'`, timeouts largos). |
| `src/__tests__/integration/concurrency.test.ts` | 13 testes de concorrência/integridade contra PostgreSQL real. |
| `src/__tests__/integration/helpers/pg.ts` | Pool, aplicação das migrations, seeds e `PlanStore` backed por SQL real. |
| `.github/workflows/ci.yml` | 2 jobs: qualidade (tipos/lint/testes) e banco (migrate deploy + **gate de drift** + integração). |
| `docker-compose.yml` + `docker/postgres-init/01-extra-databases.sql` | PostgreSQL 17 local com shadow database e banco de teste. |
| `audit/tools/verify-migrations-offline.mjs` | Verificador independente estrutura↔schema (usado porque os engines nativos do Prisma são inalcançáveis aqui). |
| `package.json` | scripts `typecheck`, `test:integration`, `db:verify`; `pg` e `@types/pg` em devDependencies. |
| `vitest.config.ts` | Exclui `src/__tests__/integration/**` da suíte padrão (ela **dropa o schema** — nunca pode rodar por engano). |
| `.env.example` | `SHADOW_DATABASE_URL` documentado. |

A baseline foi gerada pelo **schema engine real do Prisma** (`@prisma/schema-engine-wasm` na
versão exata dos engines do CLI 6.19.3: `7.1.1-3.c2990dca…`), por `diff` de `empty` →
`schemaDatamodel`, a partir do `prisma/schema.prisma` **inalterado**. Nada foi escrito à mão.

---

## 2. Verificação executada (não é simulação)

Um cluster PostgreSQL 17.11 foi inicializado no sandbox (`initdb` + `pg_ctl start`, porta
5433) e o verificador aplicou a migration e comparou o catálogo resultante com o DMMF do
schema, nas duas direções (objeto ausente **e** objeto extra): tabelas, colunas, tipos e
precisão, nullability, defaults (`now`→`CURRENT_TIMESTAMP`, `cuid`/`uuid`, literais),
PKs, `@unique`/`@@unique`, `@@index` e FKs com regra de `ON DELETE`.

```
$ DATABASE_URL=postgresql://postgres@127.0.0.1:5433/kiteos_test \
  INTERNALS_MODULE=/home/user/audit-tools/node_modules/@prisma/internals \
  node audit/tools/verify-migrations-offline.mjs

applying 0_init (48485 bytes)... ok

PostgreSQL 17.11
migrations aplicadas: 0_init
modelos no schema: 36 | tabelas no banco: 36
colunas: 616 | índices (não-PK): 135 | constraints: 95

OK: o banco migrado reproduz o schema.prisma (tabelas, colunas, tipos, defaults, PKs, uniques, índices e FKs).
exit=0
```

Dois bugs do próprio verificador foram encontrados e corrigidos no caminho (`array_agg(attname)`
precisa de `::text` para o driver `pg`; `@@unique` escrito dentro de comentário `//` no schema
era lido como declaração real — falso positivo na `Subscription`).

---

## 3. TOCTOU do contador de plano: resolvido e provado

A limitação nº 1 documentada em `IMPLEMENTACAO-FASE-2-PLANOS.md` dizia que duas requisições
concorrentes podiam ambas contar `19 < 20` e criar além do teto. A correção:

```ts
export async function lockOfficeForLimitCheck(store: PlanStore, officeId: string): Promise<void> {
  await store.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${officeId}, 0))`;
}
```

chamada em `assertCanCreate` **depois** de resolver o plano efetivo, **antes** de contar, e
**somente quando o teto não é `UNLIMITED`** (plano ilimitado não trava nem conta).

Por que advisory lock transacional e não `SELECT … FOR UPDATE` na `offices`:

- `FOR UPDATE` **não trava nada se a linha não existir** — a corrida voltaria silenciosamente;
- não acopla o guard a uma tabela específica (funciona para OS, clientes e peças);
- `pg_advisory_xact_lock` é liberada automaticamente no `COMMIT`/`ROLLBACK`, sem risco de
  trava órfã, e serializa por oficina — nunca globalmente.

Notas honestas: é específico de PostgreSQL (o datasource já é `postgresql`); e duas oficinas
diferentes podem, em tese, colidir no hash de 64 bits — o efeito seria serialização extra
entre elas, **nunca** menos segurança. A leitura da assinatura (`resolveEffectivePlan`) ocorre
antes da trava: um upgrade aprovado em paralelo só muda o teto aplicado na próxima requisição.

A prova em três camadas:

1. **Aceitação (fakes)** — `plan-policy.test.ts` (30 testes) verifica a ordem: trava → conta →
   compara; que não trava quando o pedido seria recusado de qualquer forma (`assertFeature`);
   e que não trava nem conta em plano ilimitado.
2. **Integração (PostgreSQL real)** — 12 transações concorrentes com 19 clientes e FREE (teto
   20) produzem **exatamente 1 sucesso e 11 `PlanError`**, com `count(*) = 20` no final.
3. **Controle negativo** — o mesmo fluxo **sem** a trava, com pausa entre contar e inserir,
   **ultrapassa o teto** (24 clientes onde caberiam 20). A corrida é real, não teórica.

---

## 4. Os 13 testes de integração

Rodam contra PostgreSQL real; pulam limpos (com aviso) quando `DATABASE_URL` não existe.

```
$ DATABASE_URL=postgresql://postgres@127.0.0.1:5433/kiteos_test \
  npx vitest run --config vitest.integration.config.ts

 Test Files  1 passed (1)
      Tests  13 passed (13)
```

| # | Teste | Invariante provada |
| --- | --- | --- |
| 1 | aplica as migrations versionadas num banco real | migrations sobem num PG limpo (36 tabelas) |
| 2 | 12 concorrentes, 1 vaga no FREE | exatamente 1 sucesso / 11 `PlanError`; total = teto |
| 3 | contar sem travar (controle) | sem a trava o limite **é** ultrapassado |
| 4 | 30 criações no PREMIUM | plano ilimitado não trava nem conta |
| 5 | PREMIUM `PENDENTE`, 8 concorrentes | upgrade não pago vale FREE sob concorrência |
| 6 | duas oficinas com 1 vaga cada, 8 concorrentes | a trava é por oficina, não global |
| 7 | 20 baixas concorrentes sobre saldo 5 | exatamente 5 `rowCount=1`, saldo final 0, nunca negativo |
| 8 | CAS por `version`, 10 escritores | exatamente 1 vence; os demais veem "registro alterado" |
| 9 | `UPDATE` com `officeId` de outro tenant | 0 linhas afetadas, mesmo com a PK correta |
| 10 | 25 upserts concorrentes do sequenciador | valores 1..25, todos distintos |
| 11 | 10 inserts com o mesmo `number` de venda | 1 sucesso, 9 × `23505`; outro tenant pode reusar o número |
| 12 | 10 pagamentos concorrentes de uma venda ABERTA | exatamente 1 transição para PAGA (sem liquidação dupla) |
| 13 | 10 rotações do mesmo refresh token | exatamente 1 revogação — o reuso fica detectável |

Os testes exercitam o `assertCanCreate` **de produção**: `helpers/pg.ts` implementa a fatia do
delegate do Prisma que `plans.ts` usa (`subscription.findMany`, `serviceOrder/client/part.count`
e `$queryRaw` como tagged template) sobre SQL real na mesma conexão — inclusive a trava.
As queries internas são enfileiradas porque um client `pg` não aceita consultas concorrentes
(deprecado no 8, removido no 9), e o Prisma serializa dentro da transação de qualquer forma.

---

## 5. Como rodar

**Local (Docker):**

```bash
docker compose up -d db        # cria kiteos_dev + shadow + kiteos_test
npx prisma migrate deploy      # aplica prisma/migrations
npm run test:integration       # DATABASE_URL=postgresql://kiteos:kiteos@localhost:5432/kiteos_test
```

**CI (`.github/workflows/ci.yml`)** — job `database`, com serviço `postgres:17`:

1. cria a shadow database;
2. `npx prisma migrate deploy`;
3. **gate de drift**: `npx prisma migrate diff --from-migrations prisma/migrations
   --to-schema-datamodel prisma/schema.prisma --shadow-database-url "$SHADOW_DATABASE_URL"
   --exit-code` — falha o build se alguém editar o schema sem criar migration;
4. `npm run test:integration`.

O job `quality` roda `prisma generate`, `prisma validate`, `npm run typecheck`, `npm run lint`,
os testes do produto e os de aceitação. `next build` **não** é gateado — falha ao buscar Google
Fonts e o `start` depende de `bun`; isso é o passo 2 do roadmap e está anotado no próprio
workflow.

---

## 6. O que NÃO foi validado aqui (limitações reais do sandbox)

Nada abaixo foi executado; não está declarado como validado.

1. **`prisma migrate deploy`, `prisma migrate diff --exit-code` e `prisma generate` não rodam
   neste sandbox.** Os engines nativos do Prisma vêm de `binaries.prisma.sh`, que não está na
   allowlist de rede; o pacote npm traz só o `postinstall`. Também não existe
   `@prisma/query-engine-wasm` na versão exata dos engines do repo (404), e a introspecção pelo
   engine WASM falha com `Column type 'name' could not be deserialized` (o adapter JS não
   representa o tipo `name`/OID 19 do PostgreSQL — idêntico em 6.19.2, 7.1.0 e 7.10.1).
   Consequência: **o PrismaClient real não pode ser exercitado aqui**; os testes de integração
   usam `pg` + o `PlanStore` backed por SQL. O que o Prisma geraria de SQL foi reproduzido
   literalmente nos testes (predicate de saldo, CAS de `version`, `ON CONFLICT` do sequenciador,
   CAS de status), mas o cliente em si só é coberto pelo CI.
2. **A verificação executada é estrutural e independente** (DMMF ↔ catálogo do PG real), não o
   check canônico do Prisma. Ela é estrita o bastante para pegar uma migration que não reproduz
   o schema, mas quem assina embaixo oficialmente é o gate de drift no CI.
3. **O workflow do GitHub Actions foi entregue, não executado.** Nenhum push foi feito a partir
   daqui e o Actions não roda neste sandbox. A sintaxe YAML foi validada por parser; o
   comportamento dos steps, não.
4. **`docker compose` não foi executado** (não há docker no sandbox). O PostgreSQL usado nos
   testes foi um cluster 17.11 portátil iniciado com `initdb`/`pg_ctl`, na porta 5433.
5. **`npm test` do produto continua dependendo de `prisma generate`** (`globalSetup` no
   `vitest.config.ts`). Aqui os 79 testes do produto foram executados com um client gerado pela
   receita offline (`audit/tools/gen-prisma-types-offline.cjs`, `getGenerators` com
   `skipDownload`/`noEngine`) — resultado 79/79.

---

## 7. Resultados executados nesta fase

| Verificação | Comando | Resultado |
| --- | --- | --- |
| Migrations ↔ schema no PG real | `node audit/tools/verify-migrations-offline.mjs` | exit 0, zero drift (36/36 tabelas, 616 colunas, 135 índices, 95 constraints) |
| Integração/concorrência | `npm run test:integration` | **13/13** |
| Aceitação (Fases 1+2) | `npm run test:acceptance` | **96/96** (9 arquivos) |
| Testes do produto | `vitest run src/__tests__/` (client offline) | **79/79** (7 arquivos) |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint dos arquivos novos | `eslint vitest.integration.config.ts src/__tests__/integration` | exit 0 |
| Lint do repo inteiro | `npm run lint` | **exit 0 — 0 erros**, 26 warnings (baseline anterior: 6 erros) |

Evidências brutas em `audit/evidence/`: `migrations-verify-postgres.log`,
`integration-postgres-real.log`, `acceptance-fase3-banco.log`, `product-tests-fase3-banco.log`,
`typecheck-fase3-banco.log`, `lint-integration-fase3.log`, `lint-repo-fase3-banco.log`.

**Únicas mudanças fora do escopo do passo 1**, feitas para que o gate de lint do CI seja verde
e não apenas verde por omissão — ambas são comentários, nenhum comportamento mudou:

- `src/lib/sefaz/certificate.ts`: `eslint-disable-next-line` no `require('./xml-signer')`
  pré-existente, com o motivo escrito (import estático criaria dependência circular entre
  `certificate` e `xml-signer`). O erro era do baseline; converter o `require` exigiria
  desfazer o ciclo, o que não é deste passo.
- `audit/tools/gen-prisma-types-offline.cjs`: disable de `no-require-imports`/`no-undef` no
  topo do arquivo — é um script CommonJS executado direto pelo Node, não código do produto.

---

## 8. Próximos passos do roadmap

- **2 — build/empacotamento:** Google Fonts no build, `start` usando `bun` sem `bun` no Dockerfile,
  e só então gatear `next build` no CI.
- **3 — estorno financeiro/estoque.**
- **5 — homologação fiscal:** NFS-e/SPED/fila de importação — **não pode ser declarado concluído
  sem validação externa** (contador, PVA, prefeitura).
- **6 — configuração/segredos:** `PLATFORM_ADMIN_USER_IDS`, `MP_PLATFORM_WEBHOOK_SECRET`,
  segredos por oficina.

Permanece aberto do trabalho anterior: `src/lib/numbering.ts` (`generateNextNumber`) ainda não é
atômico — o teste 10 documenta o caminho correto (upsert do `sequencers` com `ON CONFLICT`), que
é o que as rotas de OS já usam.
