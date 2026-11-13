# Auditoria KiteOS

> **Atualização 2026-11-05:** três levas de correções implementadas.
> - `IMPLEMENTACAO-FASE-1.md` — sessão, multi-tenant, vendas/PDV, OS, estoque,
>   financeiro, webhooks Mercado Pago, SSRF e mTLS.
> - `IMPLEMENTACAO-FASE-2-PLANOS.md` — limites e permissões de plano aplicados no
>   servidor (item 4 do plano).
> - `IMPLEMENTACAO-BANCO-REAL.md` — migrations versionadas, PostgreSQL 17 real,
>   testes de integração/concorrência, CI com gate de drift (item 1 do plano).
>
> Testes de aceitação: `npm run test:acceptance` (**96 testes**, Prisma mockado).
> Integração: `npm run test:integration` (**13 testes**, PostgreSQL real; pulam sem
> `DATABASE_URL`).
> Typecheck: `npm run typecheck` (**0 erros**).

- `RELATORIO-AUDITORIA.md`: relatório principal, achados, evidências, plano e critérios de produção.
- `IMPLEMENTACAO-FASE-*.md`: o que já foi corrigido, como foi validado e o que continua aberto.
- `STATUS-SONDAS.md`: quais sondas ainda se reproduzem (4 defeitos fiscais), quais foram
  corrigidas (13) e qual ficou obsoleta (1).
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
