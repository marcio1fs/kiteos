# Implementação — Passo 3: estorno financeiro e de estoque

> **Escopo:** BIZ-05 (venda paga editável/ocultável sem sincronizar o financeiro),
> BIZ-07 (EMPLOYEE podia excluir lançamento pago; `pay` não atômico) e PAY-06
> (refund/chargeback não desfaziam efeitos; idempotência do webhook só por
> consulta). Critério de saída do relatório: **saldo de estoque = soma de
> movimentos** e **financeiro concilia com vendas**.
>
> **Estado:** implementado e executado. CI run
> [`43536765399`](https://github.com/marcio1fs/kiteos/actions/runs/43536765399)
> (commit `837c9bd`): 4 jobs `success`, **integração 20/20 em PostgreSQL 17 com o
> PrismaClient real**, **aceitação 126/126**, typecheck 0 erros, lint 0 erros.
> Evidência: `audit/evidence/ci-run-43536765399.log`.

---

## 1. O ponto de partida: três caminhos que apontavam para um estorno inexistente

Antes deste passo o sistema já **recusava** as operações perigosas, mas não
oferecia a saída correta:

| Caminho | O que fazia | Consequência |
| --- | --- | --- |
| `cancelSale` (venda `PAGA`) | `409` "registre o estorno antes" | a rota de estorno não existia |
| `DELETE /api/financial/[id]` (lançamento `PAGO`) | `409` "use o estorno" | idem |
| Webhook MP `refunded` / `charged_back` | logava e respondia `200` | dinheiro devolvido no MP, venda seguia `PAGA`, estoque não voltava, razão não compensava |

Ou seja: o dinheiro podia sair pela ponta do adquirente sem nenhum reflexo no
sistema. Este passo cria o fluxo que as três mensagens já prometiam.

## 2. O modelo: nada é apagado, nada é reescrito

Um estorno é um **evento contábil**, não uma correção:

1. O lançamento original `PAGO` passa a `ESTORNADO`. A única escrita é
   `updateMany({ where: { …, status: 'PAGO' }, data: { status: 'ESTORNADO' } })` —
   nenhum valor é alterado, o documento original permanece íntegro.
2. É criado um **lançamento compensatório do tipo oposto** (`RECEBER` ↔ `PAGAR`),
   `status: 'PAGO'`, `dueDate`/`paymentDate = now`, `reference = 'ESTORNO:<entryId>'`,
   `description = 'Estorno: …'` (ou `'Estorno da venda <number>'`), herdando
   `saleId`/`supplierId`/`invoiceId`.
3. A venda `PAGA` passa a `ESTORNADA` e o estoque volta por `adjustStock`
   (movimento `ENTRADA`, delta positivo, `reference = 'SALE:<id>'`).
4. Duas trilhas de auditoria `action: 'REVERSAL'` são gravadas — uma em `Sale`,
   uma em `FinancialEntry` — com o motivo informado pelo operador.

O razão continua fechando: `RECEBER +100` e `PAGAR −100` somam zero, e o saldo de
estoque volta a ser a soma dos movimentos (uma `SAIDA` e uma `ENTRADA` da mesma
quantidade).

## 3. Concorrência e idempotência: a transição **é** a trava

Não há `SELECT … FOR UPDATE` nem coluna de versão nova. Quem decide é o
PostgreSQL:

```ts
const claimed = await tx.sale.updateMany({
  where: { id: saleId, officeId, status: 'PAGA', deleted: false },
  data: { status: SALE_REVERSED_STATUS },
});
if (claimed.count !== 1) throw new CommercialError('Venda estornada por outra operação…', 409);
```

Duas requisições simultâneas não podem ambas ver `status = 'PAGA'` no `WHERE`: uma
atualiza 1 linha e segue, a outra atualiza 0 e sai com `409` **sem nenhum efeito**.
O mesmo padrão vale para o lançamento (`claimForReversal`).

Retries (webhook do MP repetindo o evento, duplo clique) caem no caminho
idempotente: encontram `ESTORNADA`/`ESTORNADO` e devolvem o estorno já existente
com `alreadyReversed: true`. A chave de idempotência do compensatório é a própria
`reference = 'ESTORNO:<entryId>'`, consultada por `findReversalOf` antes de criar.

**BIZ-12 continua aberto**, mas mitigado: ainda não existe a restrição
`UNIQUE (officeId, sourceType, sourceId, event)` em `FinancialEntry`; hoje a
garantia vem da trava de status + da referência única por lançamento original.

## 4. RBAC: quem pode desfazer dinheiro liquidado (BIZ-07)

`assertCanReverse` aceita `OWNER`, `ADMIN` e `SYSTEM`; `EMPLOYEE` recebe `403`
**antes** de qualquer acesso ao banco. As duas rotas exigem
`requireAuth(request, undefined, 'ADMIN')`.

`SYSTEM` não é papel de usuário: o payload do JWT é tipado
`OWNER | ADMIN | EMPLOYEE` e a criação de funcionários só aceita
`EMPLOYEE | ADMIN`, então nenhuma requisição consegue reivindicá-lo — apenas
código de servidor constrói esse ator, via `systemActor(label)`.

### 4.1 Defeito encontrado neste passo: a FK de `audit_logs.userId`

`audit_logs.userId` é FK real para `users.id` (`onDelete: SetNull`). O webhook do
Mercado Pago já passava a string `'mercadopago-webhook'` como `actorId` para
`paySale` e `cancelSale` — e o novo `reverseSale` repetiria o erro. Num banco real
o `INSERT` viola a FK e **aborta a transação inteira**: todo pagamento confirmado
por webhook e todo refund falhariam em produção. Com Prisma mockado nada falha,
porque mock não tem foreign key.

Correção: ator de máquina não tem `userId`.

```ts
export type ReversalActor = { userId: string | null; role: string; label?: string | null };
export function systemActor(label: string): ReversalActor {
  return { userId: null, role: 'SYSTEM', label };
}
/** FK fica nula; a identidade vai para details.actor. */
export function auditTrail(actor) { return { userId: actor.userId, actor: actor.label ?? null }; }
```

`paySale`/`cancelSale` passaram a aceitar `actorId: string | null` + `actorLabel`,
e a rastreabilidade é preservada: o rótulo fica registrado em `details.actor`.
O teste `ator de máquina estorna sem violar a FK de audit_logs.userId` roda contra
PostgreSQL 17 real e afirma `"userId" IS NULL` nas duas trilhas — é o tipo de
verificação que só o banco de verdade pode fazer.

## 5. Devolução de estoque: a guarda que estava incompleta

`returnSaleStock` só reconhecia devolução quando `reason` começava com
`'Cancelamento'`. Como o estorno devolve com a mesma referência mas outro motivo,
**"estornar e depois cancelar" devolveria o mesmo item duas vezes** — inflando o
saldo e quebrando o critério de saída. A guarda agora é por natureza do movimento,
não por texto:

```ts
// Qualquer ENTRADA contra esta venda significa que o estoque já voltou,
// venha de cancelamento ou de estorno.
const alreadyReturned = await tx.stockMovement.findFirst({
  where: { officeId, type: 'ENTRADA', deleted: false, reference: `SALE:${sale.id}` },
});
if (alreadyReturned) return;
```

`ESTORNADA` continua cancelável (`cancelSale` aceita `['ABERTA','ESTORNADA']`),
porque dinheiro e estoque já voltaram e os dois auxiliares são idempotentes.

## 6. Rotas

| Rota | Corpo | Resposta |
| --- | --- | --- |
| `POST /api/sales/{id}/estorno` | `{ reason: 3..500 chars, paymentMethod? }` | `{ success, alreadyReversed, data }` |
| `POST /api/financial/{id}/estorno` | idem | idem |

Erros: `401` sem token, `400` motivo ausente/curto ou id inválido, `404`
cross-tenant (o `officeId` vem **sempre** do token, nunca do corpo), `409` em
conflito de estado ou de concorrência, `500` com log para o inesperado.

`POST /api/financial/{id}/estorno` **recusa lançamento com `saleId`** (`409`):
esse é estornado pelo fluxo da venda, que também devolve o estoque. Estornar só o
dinheiro deixaria os dois lados descasados. `reverseFinancialEntry` também recusa
status ≠ `PAGO` (`409`) e `totalAmount <= 0` (`400`).

## 7. Webhook do Mercado Pago (PAY-06)

```
approved                      -> paySale
rejected | cancelled          -> cancelSale
refunded | charged_back       -> reverseSale(systemActor('mercadopago-webhook'))
```

O `409` é tolerado de propósito (significa "já aplicado" ou "a venda mudou
concorrentemente") — o webhook responde `200` e o MP não fica repetindo o evento.
Refund com venda não liquidada é apenas logado: não há nada a desfazer.

## 8. Relatórios: o dinheiro estornado sai das somas

Não bastava registrar o estorno; os relatórios precisavam parar de contá-lo.
`reversal-reports.test.ts` inspeciona as consultas que as rotas de relatório
**efetivamente emitem**:

- nenhuma leitura de `FinancialEntry` pode contar `ESTORNADO` como dinheiro;
- o realizado só soma `status = 'PAGO'` — o original estornado sai, o
  compensatório entra no lado oposto (reflexo correto de partida dobrada);
- a varredura automática de atraso (`PENDENTE` → `ATRASADO`) não pode ressuscitar
  um lançamento estornado;
- no caixa, **toda** leitura de venda filtra `status = 'PAGA'`, então a venda
  `ESTORNADA` sai da gaveta sem nenhuma mudança no caixa.

## 9. Interface

- **PDV** (`pdv.tsx`): badge laranja `ESTORNADA`; o botão "Cancelar Venda" do bloco
  `PAGA` — que sempre devolvia `409` — virou **"Estornar"** (motivo obrigatório +
  confirmação); bloco novo para `ESTORNADA` com "Ver Recibo" e "Cancelar Venda".
- **Financeiro** (`financial.tsx`): badge laranja `ESTORNADO` com ícone `Undo2`,
  botão "Estornar" nas abas Pagar e Receber **somente** para `status === 'PAGO'`
  sem `saleId`, e `ESTORNADO` como opção nos dois filtros de status.

## 10. Testes

**Aceitação (Prisma mockado) — 30 novos, 126 no total:**

- `reversals.test.ts` (26): política e estados; `403` de EMPLOYEE antes de tocar o
  banco; ator de sistema e a FK nula; perdedor do CAS com `409` e zero efeitos;
  retry idempotente; sem devolução dupla de estoque; `ABERTA`/`CANCELADA` → `409`;
  cross-tenant → `404`; venda legada sem lançamento; `cancelSale` pós-estorno;
  `reverseFinancialEntry` (compensação oposta, recusa `saleId`, recusa `PENDENTE`,
  retry, corrida, valor ≤ 0); rotas (motivo obrigatório/curto, `200`, `officeId` do
  token, `401`, `409`).
- `reversal-reports.test.ts` (4): as consultas dos relatórios, descritas na seção 8.

**Integração (PostgreSQL 17 + PrismaClient + código de produção) — 7 novos, 20 no total:**
`reversal.test.ts` executa `reverseSale`/`cancelSale` **de `src/lib/sales.ts`**, não
uma reimplementação do SQL deles:

1. 10 estornos concorrentes da mesma venda → exatamente um reembolso efetivo,
   razão zero, estoque de volta uma única vez;
2. ator de máquina → trilhas de auditoria com `"userId" IS NULL` (FK intacta);
3. retry após o estorno não cria nada;
4. estorno seguido de cancelamento;
5. estorno correndo junto com cancelamento;
6. cross-tenant → `404`;
7. EMPLOYEE → `403`.

### 10.1 O que o CI pegou e o sandbox não podia

Três falhas só apareceram contra banco real ou só foram diagnosticáveis pelo CI:

- **Run `43534308174`** — job `database` vermelho no step 10, sem diagnóstico
  possível: os logs brutos do Actions ficam em host fora da allowlist do sandbox.
  A partir daí os passos de teste passaram a usar `--reporter=github-actions`
  (falhas viram anotações de check, legíveis pela API) e a publicar o placar
  (`Test Files`/`Tests`) como `::notice`.
- **Run `43534765118`** — anotação revelou `AssertionError` na linha 136: as
  trilhas de auditoria são chaveadas pela entidade que descrevem, então a de
  `FinancialEntry` carrega o id do **lançamento**, não o da venda. O código estava
  certo; a asserção consultava a chave errada.
- Dois testes meus afirmavam um *interleaving* específico em vez do invariante
  (ex.: "9 perdedores recebem `409`"). Quem perde o CAS recebe `409`, mas quem lê a
  venda **depois** do vencedor commitar cai no caminho idempotente e recebe
  `alreadyReversed` — os dois estão certos. As asserções agora contam quantos
  **efetivamente estornaram** (1) e conferem os invariantes de banco.

### 10.2 Verde falso é tratado como falha

Um teste que pula não prova nada, então o pulo silencioso virou erro em duas
camadas:

```ts
if (DATABASE_URL && (!sales || !reversals)) {
  throw new Error('DATABASE_URL está definido mas o PrismaClient não carregou; …');
}
```

e no job `database`:

```bash
if [ -z "$resumo" ]; then echo "::error …::resumo dos testes nao foi capturado"; exit 1; fi
if grep -q 'skipped' <<<"$resumo"; then echo "::error …::testes pulados com DATABASE_URL definido"; exit 1; fi
```

O passo intermediário precisou de correção: com a saída piped o vitest continua
emitindo escapes ANSI e o grep ancorado não casava — o resumo saía como
`sem resumo`, ou seja, o job media nada. Agora o log passa por
`sed -r 's/\x1b\[[0-9;]*[a-zA-Z]//g'` antes do `tee`.

## 11. Execução real

| Verificação | Onde | Resultado |
| --- | --- | --- |
| `npm run typecheck` | sandbox | exit 0 |
| `npm run lint` | sandbox | 0 erros / 26 warnings (pré-existentes) |
| `npm run test:acceptance` | sandbox | **126/126** em 11 arquivos |
| `npx vitest run --config vitest.integration.config.ts` | sandbox | **20 skipped** (sem `DATABASE_URL`; pulo limpo) |
| Integração PostgreSQL 17 + PrismaClient | CI `43536765399` | **20/20 passed** |
| Aceitação | CI `43536765399` | **126/126 passed** |
| Build de produção / imagem Docker | CI `43536765399` | `success`; `node v22.23.5 \| /app 155.8M` |
| Gate de drift (migrations × `schema.prisma`) | CI `43536765399` | `success` |

**Sem migration nova:** os status são `String` no schema, então `ESTORNADO` e
`ESTORNADA` não exigem alteração de estrutura — confirmado pelo gate de drift verde.

## 12. O que **não** foi executado aqui

- Os testes de integração não rodam no sandbox (sem Docker e sem PostgreSQL);
  rodaram apenas no CI. Nada aqui foi validado localmente contra banco real.
- `prisma generate`, `migrate` e `validate` continuam impossíveis no sandbox
  (engines em `binaries.prisma.sh` inalcançável); o client foi gerado offline só
  para typecheck, e o CI gera o client real.
- `docker build` não foi executado localmente; a imagem é construída no job
  `Imagem Docker`.
- O estorno **não** devolve dinheiro no adquirente: ele registra a devolução que o
  Mercado Pago já fez (refund) ou que o operador fez fora do sistema. Chamar a API
  de refund do MP continua fora do escopo deste passo.
- A interface foi verificada por typecheck e lint, não em navegador.

## 13. Arquivos

**Novos:** `src/lib/reversals.ts` · `src/app/api/sales/[id]/estorno/route.ts` ·
`src/app/api/financial/[id]/estorno/route.ts` ·
`src/__tests__/acceptance/reversals.test.ts` ·
`src/__tests__/acceptance/reversal-reports.test.ts` ·
`src/__tests__/integration/reversal.test.ts`

**Alterados:** `src/lib/sales.ts` (`SALE_REVERSED_STATUS`, `returnSaleStock`,
`cancelSale`, `reverseSale`, `paySale`/`cancelSale` com ator nulo) ·
`src/app/api/mercadopago/webhook/route.ts` (refund/chargeback + `MP_WEBHOOK_ACTOR`) ·
`src/components/modules/pdv.tsx` · `src/components/modules/financial.tsx` ·
`src/__tests__/integration/helpers/pg.ts` (`seedPaidSale`) ·
`.github/workflows/ci.yml` (client Prisma no job `database`, reporters, placar
publicado, guarda contra pulo)

`git diff --stat 87e5be0..837c9bd`: 12 arquivos, +1465 / −20.

Commits do passo: `84e901c` → `b192c24` → `da0961a` → `1193e22` → `7da5743` →
`2321320` → `837c9bd`.

## 14. O que continua aberto

- **Passo 5** — homologação fiscal (NFS-e, SPED, fila de importação): não pode ser
  declarado concluído sem validação externa com contador, PVA e prefeitura. As
  quatro sondas fiscais seguem se reproduzindo.
- **Passo 6** — configuração e segredos (`PLATFORM_ADMIN_USER_IDS`,
  `MP_PLATFORM_WEBHOOK_SECRET`, segredos por oficina, validação de env na partida).
- **BIZ-12** — falta a unicidade `(officeId, sourceType, sourceId, event)` em
  `FinancialEntry`; hoje a idempotência do compensatório depende da referência.
- `src/lib/numbering.ts` (`generateNextNumber`) continua não atômico.
- Allowlist SEFAZ `.gov.br` ausente no `mtls-client`.
