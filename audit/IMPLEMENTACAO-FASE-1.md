# Implementação — Fase 1 (bloqueadores de segurança e integridade)

Data: 2026-11-02 · Branch: `arena/262c9bf1-kiteos`

Esta leva implementa as correções prioritárias da auditoria nos fluxos de sessão,
multi-tenant, ordens de serviço, vendas/PDV, estoque, financeiro e webhooks
Mercado Pago. **Não torna o sistema pronto para produção**: ainda faltam
migrations, testes de integração com PostgreSQL real, build/deploy validado e
homologação fiscal.

## O que foi implementado

### Sessões e controle de acesso
- `requireAuth` revalida no banco usuário ativo/não deletado, oficina ativa/não
  deletada, tenant e papel atual a cada requisição (`resolveCurrentSession`).
- Rotação de refresh token com transação + CAS (`updateMany` com
  `isRevoked:false`), revalidação de usuário/oficina e detecção de reuso que
  revoga a família e blacklista o usuário.
- Desativação, troca de senha/papel/e-mail e exclusão de funcionário revogam
  refresh tokens e blacklistam JWTs emitidos.
- `requirePlatformAdmin` + `PLATFORM_ADMIN_USER_IDS`: administração da plataforma
  (`/api/admin/subscriptions`) não depende mais de `OWNER`/`ADMIN` de tenant.
  UI (`sidebar`, `page`) e `/api/auth/me` expõem `isPlatformAdmin`.

### Regras comerciais / multi-tenant
- `src/lib/commercial.ts`: validação Zod (dinheiro em centavos, quantidade
  positiva com até 3 casas), erros de negócio mapeados para 4xx e `adjustStock`
  com UPDATE condicional por `tenant + version + quantity gte` usando
  `Prisma.Decimal` (rollback por erro em caso de conflito/oversell).
- Vendas (`/api/sales`, `/api/pdv`) compartilham `src/lib/sales.ts`:
  - criação transacional com reserva de estoque, validação de cliente/vendedor,
    desconto ≤ subtotal, numeração por oficina via `Sequencer`;
  - pagamento idempotente com CAS de status `ABERTA → PAGA` e lançamento
    financeiro criado na mesma transação;
  - cancelamento devolve estoque uma única vez e bloqueia cancelamento direto de
    venda paga (exige estorno);
  - valores de venda paga/cancelada são imutáveis; `DELETE` só oculta venda
    cancelada; `PUT` rejeita campos desconhecidos (sem mass assignment).
- Ordens de serviço (`src/lib/service-orders.ts` + rotas):
  - itens atualizados/excluídos sempre com predicado
    `id + serviceOrderId + officeId`; item de outro tenant é rejeitado;
  - CAS de versão da OS antes de mexer em itens/estoque;
  - criação/edição/cancelamento/status usam `adjustStock` e totais em centavos;
  - pagamento cria financeiro com valor líquido correto (sem descontar duas vezes).
- Estoque (`/api/stock-movements`) e peças (`/api/parts/[id]`) com escopo por
  tenant e atualização condicional; movimentação manual usa o mesmo helper.
- Financeiro:
  - `PUT`/`DELETE` exigem `ADMIN`, validam fornecedor do tenant e bloqueiam
    edição/exclusão de lançamento pago ou gerado por venda;
  - pagamento (`/api/financial/pay/[id]`) com CAS de status e auditoria na mesma
    transação; exclusão de lançamento pago é recusada.

### Mercado Pago
- `src/lib/mercadopago-webhook.ts` usa o validador oficial do SDK
  (`WebhookSignatureValidator`) com manifesto `id;request-id;ts` e tolerância de
  5 min; o manifesto legado `ts.rawBody` foi removido.
- Webhooks de venda e assinatura rebuscam o pagamento na API do MP, validam
  `collector_id`, moeda e valor em centavos contra o total esperado; underpay
  gera auditoria e não quita a venda/assinatura.
- Quitação de venda usa o mesmo `paySale` idempotente; referência externa nova
  `SALE:<officeId>:<saleId>` (compatível com referência legada por número).
- `create-payment` bloqueia venda não aberta/total zero, aloca desconto para que
  a preferência cobre exatamente o total e usa chave de idempotência.
- `PUT /api/subscriptions/[id]` não permite mais trocar plano manualmente;
  upgrade/downgrade passa pelo checkout. Cancelamento continua disponível ao
  proprietário.

### Integrações externas / fiscal
- `src/lib/safe-url.ts`: guarda SSRF para URLs configuradas por tenant
  (HTTPS, bloqueio de localhost/IPs privados/reservados, DNS pinning contra
  rebinding, sem redirects). Aplicada às rotas de WhatsApp.
- mTLS SEFAZ (`mtls-client.ts`): `rejectUnauthorized:true`, certificado A1
  obrigatório, HTTPS obrigatório e CA extra opcional via
  `SEFAZ_EXTRA_CA_CERTS`. Recursos fiscais continuam **sem homologação**.

## Validação executada

| Verificação | Resultado |
|---|---|
| `npm run test:acceptance` (Vitest, Prisma mockado) | **39/39 testes passaram** nesta leva (94/94 após a Fase 2) |
| `npx tsc --noEmit --incremental false` | **0 erros** (tipos Prisma gerados offline) |
| `npx eslint` nos arquivos alterados | **0 erros/warnings** |

Evidências: `audit/evidence/acceptance-fase1.log`, `typecheck-fase1.log`,
`lint-fase1.log`.

Os testes de aceitação verificam predicados de tenant, guardas CAS, idempotência,
validação de valor/assinatura e bloqueio de operações inseguras. Eles usam
Prisma mockado e **não** comprovam isolamento/concorrência em PostgreSQL real.
As 18 sondas históricas em `audit/*.probe.test.ts` caracterizavam os defeitos
antigos e não são testes de aceitação; várias deixam de reproduzir o defeito
após estas correções.

## Limitações e próximos passos

1. ~~**Banco real**: criar migrations versionadas, subir PostgreSQL e rodar testes
   de integração/concorrência (oversell, refresh simultâneo, webhook duplicado).~~
   **Concluído** — ver `IMPLEMENTACAO-BANCO-REAL.md`: `prisma/migrations/0_init`
   gerada pelo schema engine real e verificada num PostgreSQL 17.11 (zero drift),
   13 testes de integração/concorrência passando (oversell, CAS de `version` e de
   status, sequência única, unicidade de venda por tenant, revogação de refresh
   token, limite de plano com trava transacional), CI com gate de drift e
   `docker-compose` para o banco local.
2. **Build/deploy**: build ainda depende de Google Fonts e o `start` usa bun;
   alinhar Dockerfile/CI e validar `next build` em ambiente com rede.
3. **Estorno financeiro**: implementar fluxo explícito de estorno para vendas e
   lançamentos pagos antes de permitir cancelamento.
4. ~~**Limites de plano**: aplicar enforcement de `maxOS/maxClients/maxParts` e
   recursos por plano no servidor.~~ **Concluído** — ver
   `IMPLEMENTACAO-FASE-2-PLANOS.md`.
5. **Fiscal**: NFS-e/SPED/import queue seguem sem transmissão/validação real;
   exigem homologação com contador/PVA antes de uso produtivo.
6. **Configuração**: definir `PLATFORM_ADMIN_USER_IDS`,
   `MP_PLATFORM_WEBHOOK_SECRET` e segredos por oficina antes de habilitar
   administração da plataforma e webhooks.
