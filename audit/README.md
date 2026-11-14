# Auditoria KiteOS

> **Atualização 2026-11-14:** sete levas de correções implementadas — todos os
> sete passos numerados do relatório foram atacados.
> - `IMPLEMENTACAO-FASE-1.md` — sessão, multi-tenant, vendas/PDV, OS, estoque,
>   financeiro, webhooks Mercado Pago, SSRF e mTLS.
> - `IMPLEMENTACAO-FASE-2-PLANOS.md` — limites e permissões de plano aplicados no
>   servidor (item 4 do plano).
> - `IMPLEMENTACAO-BANCO-REAL.md` — migrations versionadas, PostgreSQL 17 real,
>   testes de integração/concorrência, CI com gate de drift (item 1 do plano).
> - `IMPLEMENTACAO-BUILD.md` — fontes locais no lugar de Google Fonts, `start` sem
>   `bun`, Dockerfile em Node 22, jobs de build e de imagem no CI (item 2 do plano).
> - `IMPLEMENTACAO-ESTORNOS.md` — estorno explícito de venda e de lançamento
>   (itens BIZ-05, BIZ-07 e PAY-06 do plano): nada é apagado nem reescrito, o
>   lançamento vira `ESTORNADO` com um compensatório do tipo oposto, a venda vira
>   `ESTORNADA` com o estoque de volta, e refund/chargeback do Mercado Pago desfaz
>   os efeitos. Inclui a correção da FK `audit_logs.userId` para atores de máquina.
> - `IMPLEMENTACAO-FISCAL.md` — fim dos status fiscais fictícios (itens FISC-01,
>   FISC-02, FISC-04, NOT-01 e parte de FISC-08) e layout do SPED conferido contra o
>   Guia Prático (FISC-03). NFS-e nasce `RPS` e só vira `EMITIDA` com prova de
>   autorização; nota de venda nasce `RASCUNHO`; a fila de importação só conclui com
>   nota gravada; e-mail sem provedor não é `ENVIADA`.
>   **Não inclui homologação externa**: não há provedor de NFS-e integrado nem
>   validação do SPED no PVA — ver as seções 9 e 12 daquele documento.
> - `IMPLEMENTACAO-CONFIG.md` — configuração e segredos (itens CFG-01 a CFG-07).
>   `src/lib/env.ts` como fonte única, validação na partida por
>   `src/instrumentation.ts` (produção encerra com `exit 1`), `/api/health` e
>   `/api/ready` com HEALTHCHECK do container apontado para o segundo, URL pública
>   sem fallback para `localhost`, fim do plaintext silencioso em tokens de oficina
>   e `.env.example` reescrito. Verificado **executando o servidor real**.
>
> Testes de aceitação: `npm run test:acceptance` (**237 testes**, Prisma mockado).
> Integração: `npm run test:integration` (**24 testes**, PostgreSQL real; pulam sem
> `DATABASE_URL` — e o CI trata pulo com banco configurado como falha).
> Typecheck: `npm run typecheck` (**0 erros**).
> Última execução completa: CI run
> [`43545574204`](https://github.com/marcio1fs/kiteos/actions/runs/43545574204),
> 4 jobs `success` — aceitação **237/237**, integração **24/24**, sem migration
> nova (evidência em `evidence/ci-run-43545574204.log` e, do servidor executado,
> `evidence/servidor-passo6.log`).

- `RELATORIO-AUDITORIA.md`: relatório principal, achados, evidências, plano e critérios de produção.
- `IMPLEMENTACAO-*.md`: o que já foi corrigido, como foi validado e o que continua aberto.
- `STATUS-SONDAS.md`: **24 sondas corrigidas** (falham = o defeito não se reproduz
  mais) e **1 obsoleta** (a 18, do webhook do Mercado Pago). Nenhuma sonda de
  defeito real passa hoje: 26 falham / 1 passa em 27 testes.
- `*.probe.test.ts`: sondas de caracterização escritas **antes** das correções.
  **Passar = reproduzir o defeito da época.** Depois das Fases 1 e 2 várias delas
  deixam de passar — isso é o comportamento esperado e significa que o defeito foi
  corrigido. Elas não são testes de regressão de segurança; os testes de aceitação
  em `src/__tests__/acceptance/` é que exigem o comportamento seguro.
- `vitest.config.ts`: configuração isolada das sondas (não altera a suíte do produto).
- `tools/gen-prisma-types-offline.cjs`: gera o Prisma Client sem baixar engines
  (necessário para `tsc` em ambiente sem acesso a `binaries.prisma.sh`).
- `tools/verify-migrations-offline.mjs`: aplica `prisma/migrations` num PostgreSQL
  real e compara a estrutura resultante com o `schema.prisma` (via DMMF), nas duas
  direções. Substitui o `prisma migrate diff --exit-code` quando os engines nativos
  não podem ser baixados; exige `DATABASE_URL` e `INTERNALS_MODULE`.
- `evidence/`: logs de aceitação, integração, migrações, typecheck, lint e npm audit.

Executar sondas:

```bash
npx vitest run --config audit/vitest.config.ts
```

Executar testes de aceitação:

```bash
npm run test:acceptance
```

Executar testes de integração contra PostgreSQL real (o banco é **zerado**: as
migrations são reaplicadas sobre um `public` recém-criado):

```bash
docker compose up -d db
DATABASE_URL=postgresql://kiteos:kiteos@localhost:5432/kiteos_test npm run test:integration
```
