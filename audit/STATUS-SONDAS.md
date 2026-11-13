# Status das sondas após as Fases 1 e 2

Data: 2026-11-05 · Comando: `npx vitest run --config audit/vitest.config.ts`
· Evidência: `evidence/probes-pos-fase1-2.log`

As sondas (`audit/*.probe.test.ts`) foram escritas **antes** de qualquer correção
para caracterizar defeitos reais. A convenção é invertida de propósito:

> **Sonda que passa = o defeito ainda se reproduz. Sonda que falha = o defeito foi corrigido.**

Resultado atual: **13 falham / 5 passam** (de 18).

## Corrigidos (sonda falha — 13)

| # | Sonda | Corrigido em |
|---|---|---|
| 1 | PDV aceita quantidade negativa, total negativo e aumenta o estoque | Fase 1 (`src/lib/sales.ts`, schemas) |
| 2 | PDV mascara venda acima do saldo transformando estoque em zero | Fase 1 (`adjustStock` com CAS) |
| 3 | Alterar desconto de venda PAGA não sincroniza o financeiro | Fase 1 (venda paga é imutável) |
| 4 | Excluir venda PAGA apenas oculta, sem estornar | Fase 1 (`DELETE` só em CANCELADA) |
| 5 | OS permite atualizar item de outro tenant só com o ID do item | Fase 1 (`src/lib/service-orders.ts`) |
| 6 | Movimentação de estoque sobrescreve saldo concorrente | Fase 1 (`adjustStock` condicional) |
| 7 | EMPLOYEE exclui lançamento financeiro PAGO sem estorno | Fase 1 (ADMIN + CAS + imutabilidade) |
| 8 | OWNER troca FREE por PREMIUM sem pagamento confirmado | Fase 1 (upgrade só via checkout) |
| 9 | Webhook aprova venda de R$100 com pagamento de R$1 | Fase 1 (valor/moeda em centavos) |
| 10 | JWT de usuário desativado continua autorizado | Fase 1 (`resolveCurrentSession`) |
| 11 | Refresh renova sessão sem revalidar usuário/office/papel | Fase 1 (`rotateRefreshToken`) |
| 12 | WhatsApp permite URL interna arbitrária (SSRF) | Fase 1 (`src/lib/safe-url.ts`) |
| 13 | Cliente mTLS desativa a validação do certificado | Fase 1 (`rejectUnauthorized: true`) |

## Ainda em aberto (sonda passa — 4 defeitos reais)

Todos do módulo fiscal, que depende de homologação externa:

| # | Sonda | Situação |
|---|---|---|
| 14 | Fila assíncrona declara importação COMPLETED sem consultar SEFAZ | Aberto — item 5 do plano |
| 15 | E-mail não integrado é persistido como ENVIADA | Aberto — item 5 do plano |
| 16 | NFS-e é persistida como EMITIDA sem transmissão ao município | Aberto — item 5 do plano |
| 17 | SPED: H010 desloca unidade/quantidade/valor e 0200 usa campos incompatíveis | Aberto — item 5 do plano |

## Sonda obsoleta (passa, mas não caracteriza mais o defeito — 1)

| # | Sonda | Por quê |
|---|---|---|
| 18 | "Webhook rejeita assinatura válida no formato oficial do Mercado Pago" | O manifesto oficial `id;request-id;ts` **é aceito** desde a Fase 1 (`src/lib/mercadopago-webhook.ts` usa o validador do SDK). A sonda continua passando por outro motivo: ela usa `data.id = "pay-1"`, e a rota hoje só busca pagamentos com ID numérico, então não chama a API do MP. O comportamento seguro está coberto por `src/__tests__/acceptance/mercadopago.test.ts` ("accepts the official id/request-id/ts manifest" e "rejects the legacy ts.rawBody manifest"). |

Esta sonda não deve ser lida como "webhook ainda quebra assinatura oficial".

## Como ler daqui em diante

- Para saber se um comportamento seguro está garantido, use
  `npm run test:acceptance` (94 testes) — estes **exigem** o comportamento correto.
- As sondas servem como registro histórico do estado anterior à correção. Ao
  concluir o item 5 (fiscal), as sondas 14–17 devem falhar e ser substituídas por
  testes de aceitação equivalentes.
