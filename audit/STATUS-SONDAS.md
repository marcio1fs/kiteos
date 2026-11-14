# Status das sondas após as Fases 1 e 2 e os passos 3 e 5

Data: 2026-11-14 · Comando: `npx vitest run --config audit/vitest.config.ts`
· Evidência: `evidence/probes-pos-passo5.log` (atual) e
`evidence/probes-pos-fase1-2.log` (histórico)

As sondas (`audit/*.probe.test.ts`) foram escritas **antes** de qualquer correção
para caracterizar defeitos reais. A convenção é invertida de propósito:

> **Sonda que passa = o defeito ainda se reproduz. Sonda que falha = o defeito foi corrigido.**

Resultado atual: **17 falham / 1 passa** (de 18). Todas as sondas que caracterizavam
defeitos reais deixaram de passar; a única que passa é a obsoleta (seção final).

## Corrigidos (sonda falha — 17)

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
| 14 | Fila assíncrona declara importação COMPLETED sem consultar SEFAZ | **Passo 5** (`src/lib/sefaz/nfe-import.ts`; job só conclui com nota gravada) |
| 15 | E-mail não integrado é persistido como ENVIADA | **Passo 5** (sem provedor fica `PENDENTE` + `notIntegrated`) |
| 16 | NFS-e é persistida como EMITIDA sem transmissão ao município | **Passo 5** (criação gera `RPS`; `EMITIDA` só via `transmitNfse` com prova) |
| 17 | SPED: H010 desloca unidade/quantidade/valor e 0200 usa campos incompatíveis | **Passo 5** (`0100`/`0200`/`H010` conforme o Guia Prático) |

As sondas 3, 4 e 7 também passaram a falhar de novo depois do **passo 3** por outro
motivo: o comportamento que elas caracterizavam foi substituído pelo estorno
explícito (`audit/IMPLEMENTACAO-ESTORNOS.md`).

> **Atenção ao ler a sonda 16/17 como "fiscal pronto":** elas falham porque o
> status fictício e o layout errado deixaram de existir — **não** porque o sistema
> emite documentos. Não há provedor de NFS-e integrado nem validação no PVA; ver
> `IMPLEMENTACAO-FISCAL.md`, seções 9 e 12.

## Sonda obsoleta (passa, mas não caracteriza mais o defeito — 1)

| # | Sonda | Por quê |
|---|---|---|
| 18 | "Webhook rejeita assinatura válida no formato oficial do Mercado Pago" | O manifesto oficial `id;request-id;ts` **é aceito** desde a Fase 1 (`src/lib/mercadopago-webhook.ts` usa o validador do SDK). A sonda continua passando por outro motivo: ela usa `data.id = "pay-1"`, e a rota hoje só busca pagamentos com ID numérico, então não chama a API do MP. O comportamento seguro está coberto por `src/__tests__/acceptance/mercadopago.test.ts` ("accepts the official id/request-id/ts manifest" e "rejects the legacy ts.rawBody manifest"). |

Esta sonda não deve ser lida como "webhook ainda quebra assinatura oficial".

## Como ler daqui em diante

- Para saber se um comportamento seguro está garantido, use
  `npm run test:acceptance` (**172 testes**) — estes **exigem** o comportamento
  correto.
- As sondas servem como registro histórico do estado anterior à correção. As sondas
  14–17 já falham e foram substituídas por testes de aceitação equivalentes:
  `src/__tests__/acceptance/fiscal-honesty.test.ts` (24),
  `src/__tests__/acceptance/sped-layout.test.ts` (8) e
  `src/__tests__/acceptance/nfe-import.test.ts` (14, cobre o núcleo da importação
  que a sonda 14 caracteriza pela fila).
- As sondas continuam no repositório de propósito: se alguém reintroduzir um status
  fiscal fictício ou o layout antigo do SPED, a sonda correspondente volta a passar
  e o sinal fica visível.
