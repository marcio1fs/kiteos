# Auditoria de prontidão para produção — KiteOS

**Data:** 02/11/2026  
**Repositório:** `marcio1fs/kiteos` · branch `arena/262c9bf1-kiteos` · commit base `688cdb3`  
**Escopo:** SaaS de gestão de oficinas mecárias (não ERP genérico), com foco em arquitetura, regras de negócio, segurança multi-tenant, fiscal brasileiro, testes e operação.

---

## 1. Veredito executivo

**Não recomendado para produção com dados reais de clientes.** O projeto tem uma base funcional ampla — clientes, veículos, OS, PDV, estoque, financeiro, caixa, assinaturas, NF-e/NFS-e/SEFAZ, SPED, Mercado Pago, WhatsApp e IA — mas ainda apresenta falhas que podem causar **vazamento entre tenants, corrupção de estoque/financeiro, ativação de plano sem pagamento, emissão fiscal fictícia e perda de documentos fiscais**.

O problema não é “falta de telas”. O núcleo transacional e fiscal ainda não é confiável. Comentários `SECURITY FIX`, relatórios históricos e testes utilitários aprovados **não** comprovam prontidão.

### Bloqueadores imediatos (P0)

1. **Isolamento multi-tenant incompleto** em itens de OS e painel administrativo de assinaturas.
2. **Estoque e financeiro sem atomicidade/idempotência suficientes** em vendas, pagamentos, cancelamentos e movimentações.
3. **Mercado Pago incompatível com o formato oficial de assinatura** e sem validação de valor pago.
4. **NFS-e e notas de cliente marcadas como emitidas/canceladas sem transmissão ao órgão fiscal.**
5. **SPED com layout inválido** e dados fiscais hardcoded.
6. **mTLS com validação TLS desativada** e SSRF em configuração de WhatsApp.
7. **Sessões não revalidam usuário/office ativos**; tokens em `localStorage`.
8. **Sem migrations versionadas, sem CI reproduzível e build não validado** neste ambiente.

### O que já existe e pode ser aproveitado

- Schema Prisma com 36 modelos e índices por `officeId` em muitas entidades.
- CRUDs e módulos de UI para o fluxo oficina→OS→venda→financeiro.
- Hash bcrypt, JWT com expiração, refresh token com rotação e blacklist.
- Criptografia AES-GCM para tokens/certificados com chave obrigatória.
- Cliente SOAP SEFAZ, parser XML, assinatura XML, manifestação e SPED em blocos 0/C/D/E/H/1/9.
- Integração Mercado Pago, WhatsApp (Z-API/Evolution) e assistente IA.
- 7 suítes utilitárias/SEFAZ e sondas de auditoria reproduzíveis.

**Conclusão:** há produto em construção, não ERP pronto para produção. A prioridade é corrigir integridade, segurança e fiscal antes de adicionar funcionalidades.

---

## 2. Metodologia e limitações

### O que foi feito

- Leitura estática de auth, proxy, schema, APIs comerciais/fiscais/admin, libs SEFAZ/NFS-e/SPED, store frontend, Docker e scripts.
- Inventário: **97 arquivos de rota** em `src/app/api`, **149 handlers HTTP**, **36 modelos Prisma**.
- Execução de lint, typecheck, build, testes existentes e `npm audit`.
- Criação de **18 sondas de caracterização** em `audit/*.probe.test.ts` que reproduzem defeitos com banco/rede simulados. **Passar nessas sondas significa confirmar o comportamento inseguro atual, não aprovar o produto.**
- Validação do schema via WASM do Prisma (`getDMMF`): 36 modelos carregados sem erro de schema.
- Geração offline de tipos Prisma para typecheck; **não** houve conexão a PostgreSQL nem engine nativa válida.

### O que NÃO foi validado

- PostgreSQL real, migrations, concorrência real, isolamento em banco, backup/restore.
- Homologação SEFAZ/prefeitura, PVA do SPED, certificados A1 reais, NFS-e nacional.
- Sandbox/produção Mercado Pago, WhatsApp real, IA real.
- Build de produção completo (bloqueado por Google Fonts neste ambiente).
- Testes E2E de UI, carga, penetração externa, LGPD jurídica.

Achados marcados como **estáticos** decorrem de leitura de código; os marcados como **sonda** foram reproduzidos com mocks. Nenhum achado depende de relatório histórico do repositório.

---

## 3. Achados priorizados

Severidades: **P0** = bloqueia produção; **P1** = corrigir antes de escala/cockpit fiscal; **P2** = hardening/qualidade.

### A. Segurança e multi-tenancy

| ID | Sev. | Achado | Evidência | Impacto | Correção mínima |
|---|---|---|---|---|---|
| SEC-01 | P0 | OS atualiza item por ID sem validar vínculo com a OS/tenant | `src/app/api/service-orders/[id]/route.ts:303-315` | Usuário do office A pode alterar item do office B se souber o ID; totais/estoque inconsistentes | `updateMany where {id, serviceOrderId, officeId}` ou FK composta; rejeitar IDs não pertencentes |
| SEC-02 | P0 | Painel admin de assinaturas acessível a ADMIN de qualquer office e retorna dados de todos | `src/app/api/admin/subscriptions/route.ts:27,64-93` | Vazamento cross-tenant de PII, CNPJ, contatos e MRR | Separar papel de plataforma de `ADMIN` do tenant; escopo por office ou authz de plataforma |
| SEC-03 | P0 | Sessão não revalida usuário/office ativos; refresh reutiliza role/office antigos | `src/lib/auth.ts:163-194,259-345`; `src/app/api/employees/[id]/route.ts:185-193` | Funcionário desativado continua operando; promoção/rebaixamento não reflete | Revalidar `user.active`, `office.active`, role e office a cada request/refresh; revogar sessões ao desativar |
| SEC-04 | P0 | mTLS desativa validação do servidor | `src/lib/sefaz/mtls-client.ts:43` | MITM pode interceptar certificado cliente e documentos fiscais | `rejectUnauthorized:true`, cadeia ICP-Brasil/CA adequada, pinning opcional; nunca desabilitar TLS |
| SEC-05 | P0 | SSRF em teste de conexão WhatsApp | `src/app/api/whatsapp/config/route.ts:154-199` | Usuário autenticado pode fazer o servidor chamar URL interna/metadata | Allowlist de hosts HTTPS, bloquear IPs privados/link-local/loopback, validar DNS rebinding, timeout e tamanho |
| SEC-06 | P1 | Tokens access+refresh em localStorage | `src/lib/store.ts:63-66,93-96,267` | Roubo por XSS; refresh prolonga comprometimento | Preferir cookies HttpOnly/Secure/SameSite; CSRF token; não expor refresh em JSON |
| SEC-07 | P1 | Refresh rotation sem transação/CAS; replay de POST após 401 | `src/lib/auth.ts:305-329`; `src/lib/store.ts:229-303` | Corrida de refresh; replay não idempotente de venda/pagamento | Rotação atômica com `updateMany where isRevoked:false`; retry apenas idempotente ou com idempotency key |
| SEC-08 | P1 | Login busca email sem tenant, register exige email global | `src/app/api/auth/login/route.ts`; `src/app/api/auth/register/route.ts`; `prisma/schema.prisma:112` | Ambiguidade/colisão de identidade em SaaS multi-tenant | Definir identidade global ou por tenant; login inclui office ou email global único |
| SEC-09 | P1 | `financial/[id]` aceita `supplierId` sem validar tenant | `src/app/api/financial/[id]/route.ts:143,216` | Associação cross-tenant e vazamento por joins | Validar supplier por officeId antes de gravar |
| SEC-10 | P2 | Logos servidos publicamente; limite real 5 MB apesar de comentário 500 KB | `src/app/api/uploads/logos/[filename]/route.ts` | Exposição não intencional; consumo de disco | Authz se logos forem privados; limites reais; storage externo; scanning de conteúdo |

**Sondas:** SEC-01, SEC-03, SEC-04, SEC-05 reproduzidas em `audit/business.probe.test.ts` e `audit/security.probe.test.ts`.

### B. Vendas, estoque, financeiro e caixa

| ID | Sev. | Achado | Evidência | Impacto | Correção mínima |
|---|---|---|---|---|---|
| BIZ-01 | P0 | PDV aceita quantidade/preço negativos ou não finitos; quantidade negativa aumenta estoque | `src/app/api/pdv/route.ts:89-106,155-179` | Estoque e receita corrompidos; total pode ser zerado/negativo | Zod com `positive()`, `finite()`, desconto ≤ subtotal; rejeitar item negativo |
| BIZ-02 | P0 | PDV não revalida saldo/version dentro da transação e usa `Math.max(0, saldo-saída)` | `src/app/api/pdv/route.ts:108-127,157-167` | Venda acima do saldo vira estoque zero silenciosamente; oversell | Update condicional `quantity >= qtd` ou decrement atômico; falhar se 0 linhas |
| BIZ-03 | P0 | `stock-movements` lê saldo fora da transação e sobrescreve saldo concorrente | `src/app/api/stock-movements/route.ts:122-178` | Perda de atualização; saldo negativo | Ler dentro da transação com lock/CAS; movimento e saldo na mesma atomicidade |
| BIZ-04 | P0 | `estoque/movimentar` ignora conflito de version e reporta sucesso | `src/app/api/estoque/movimentar/route.ts:162-187` | Entrada de NF-e pode não aplicar saldo mas criar movimento/auditoria | Retry limitado ou abortar transação quando `count===0` |
| BIZ-05 | P0 | Venda paga pode ter desconto/total alterados sem sincronizar financeiro; DELETE só oculta | `src/app/api/sales/[id]/route.ts:190-204,242-245` | Razão financeiro diverge da venda; exclusão não estorna | Bloquear edição de venda paga; estorno explícito com lançamento reverso |
| BIZ-06 | P0 | Pagamento/cancelamento de venda lê status fora da transação | `src/app/api/sales/[id]/route.ts:67-84,136-137` | Duplo pagamento/estoque em concorrência | Transição com `updateMany where status` e contagem; idempotency key |
| BIZ-07 | P0 | EMPLOYEE pode excluir lançamento PAGO; pay não é atômico | `src/app/api/financial/[id]/route.ts:247-277`; `src/app/api/financial/pay/[id]/route.ts:32-117` | Fraude/ocultação de receita; pagamento duplicado | RBAC por ação; estorno em vez de delete; pay com CAS e auditoria na transação |
| BIZ-08 | P1 | PDV não vincula vendedor/caixa; `sales` e `pdv` divergem | `src/app/api/pdv/route.ts:133-145`; `src/app/api/sales/route.ts:214-232` | Caixa não fecha com vendas; rastreabilidade perdida | Unificar serviço de venda; `userId` do token; `cashSessionId` obrigatório quando caixa aberto |
| BIZ-09 | P1 | Caixa sem trava de sessão; método contendo “DINHEIRO” tratado como dinheiro integral | `src/app/api/cash-register/route.ts:56-66,134-232` | Fechamento concorrente; pagamento misto distorce saldo | Lock por sessão; métodos estruturados; validar transições e valores |
| BIZ-10 | P1 | Numeração por MAX/count fora de transação; Sequencer ignorado | `src/lib/numbering.ts:16-100`; `src/app/api/pdv/route.ts:75-83` | Números duplicados/saltos sob concorrência | Sequência transacional por office/série; unique constraint e retry |
| BIZ-11 | P1 | OS troca peça sem repor/baixar corretamente; mecânico sem validação de tenant | `src/app/api/service-orders/[id]/route.ts:250-315` | Estoque e comissão incorretos | Validar peça/mecânico por office; calcular delta por item original; ledger de estoque |
| BIZ-12 | P1 | Financeiro sem unicidade de origem; lançamentos duplicáveis | `prisma/schema.prisma:531-567` | Webhook/retry cria múltiplos lançamentos | Unique parcial por `(officeId, sourceType, sourceId, event)` |

**Sondas:** BIZ-01, BIZ-02, BIZ-03, BIZ-05, BIZ-07 reproduzidas.

### C. Mercado Pago e assinaturas

| ID | Sev. | Achado | Evidência | Impacto | Correção mínima |
|---|---|---|---|---|---|
| PAY-01 | P0 | Assinatura HMAC usa `ts.body`, não o manifesto oficial `id:data.id;request-id:x-request-id;ts:ts;` | `src/app/api/mercadopago/webhook/route.ts:43`; `subscription-webhook/route.ts:36` | Webhooks legítimos são ignorados; vendas/assinaturas não atualizam | Usar SDK/validador oficial; testar com payloads reais de sandbox |
| PAY-02 | P0 | Webhook não compara `transaction_amount`/moeda com total esperado | `src/app/api/mercadopago/webhook/route.ts:119-235` | Pagamento de R$1 pode quitar venda de R$100 | Validar valor, moeda, status, seller e referência antes de marcar PAGA |
| PAY-03 | P0 | Cartão soma itens sem desconto; PIX usa total; webhook desconta desconto de total já líquido | `create-payment/route.ts:71-123`; `webhook/route.ts:224-227` | Cobrança e financeiro divergem | Fonte única de totais; desconto alocado; conciliação por pagamento |
| PAY-04 | P0 | OWNER de assinatura ATIVA troca FREE→PREMIUM sem pagamento | `src/app/api/subscriptions/[id]/route.ts:138-232` | Bypass de billing | Só ativar plano pago após evento aprovado; upgrade cria intenção pendente |
| PAY-05 | P0 | Limites de plano não são enforced nas APIs de criação | `src/app/api/subscriptions/check/route.ts`; ausência de checagem em `service-orders`, `clients`, `parts`, `ai`, `whatsapp` | Plano FREE usa recursos pagos ilimitados | Middleware/serviço de entitlement transacional; contadores atômicos |
| PAY-06 | P1 | Webhook idempotência só por consulta; estorno/chargeback não desfaz efeitos | `webhook/route.ts:161-176,260-272` | Duplicidade e receita/estoque incorretos após refund | Tabela de eventos com unique; máquina de estados; estorno de estoque/financeiro |
| PAY-07 | P1 | Subscription sem unique por office; trial expirado retorna limites antigos | `prisma/schema.prisma:573-598`; `subscriptions/check/route.ts:43-125` | Múltiplas assinaturas e entitlement inconsistente | Unique parcial por office ativo; recalcular plano efetivo por período |
| PAY-08 | P1 | Configurar token MP sem secret zera secret | `src/app/api/mercadopago/config/route.ts` | Webhook passa a rejeitar tudo | Atualização parcial; exigir secret junto ao token |

**Sondas:** PAY-01, PAY-02, PAY-04 reproduzidas. O formato oficial do manifesto é documentado pelo Mercado Pago [1](https://www.mercadopago.com.br/developers/en/docs/checkout-api/additional-content/your-integrations/notifications/webhooks).

### D. Fiscal brasileiro (NF-e, NFS-e, SEFAZ, SPED)

| ID | Sev. | Achado | Evidência | Impacto | Correção mínima |
|---|---|---|---|---|---|
| FISC-01 | P0 | NFS-e gravada como EMITIDA sem transmissão à prefeitura | `src/app/api/nfse/route.ts:180-231` | Documento fiscal fictício; risco legal/contábil | Separar RPS/rascunho de autorização; transmitir e só então marcar emitida |
| FISC-02 | P0 | ClientInvoice gravada EMITIDA/CANCELADA sem SEFAZ | `src/app/api/client-invoices/route.ts:304,468`; `[id]/cancel/route.ts:45-57` | Nota de venda não autorizada aparece como emitida | Integrar emissão/consulta/cancelamento reais; status sincronizado |
| FISC-03 | P0 | SPED com campos incompatíveis e dados hardcoded | `src/lib/sped/sped-generator.ts:247,319,379-386,1057-1069` | Arquivo rejeitado pelo PVA; escrituração inválida | Reescrever layout conforme guia vigente; validar no PVA; contador real |
| FISC-04 | P0 | Fila de importação marca COMPLETED sem importar | `src/lib/sefaz/import-queue.ts:96-146`; `api/sefaz/importar-async/route.ts:50-60` | Usuário acredita que NF-e foi importada; perda operacional | Worker real (BullMQ/fila persistente) ou remover endpoint até existir |
| FISC-05 | P1 | Manifestação PENDENTE bloqueia reenvio; sem unique/lock | `src/app/api/sefaz/manifestacao/route.ts:109-122,163-176` | Evento travado após falha; duplicidade em concorrência | Estado machine com timeout/retry; unique por chave+tipo+seq |
| FISC-06 | P1 | Manifestação pode enviar XML não assinado; `nSeqEvento` fixo 1 | `src/lib/sefaz/manifestacao.ts:94-149` | Rejeição SEFAZ e eventos duplicados | Falhar se assinatura obrigatória falhar; sequência por evento |
| FISC-07 | P1 | Verificador XML só valida RSA-SHA1 do SignedInfo | `src/lib/sefaz/xml-signer.ts:291-327` | Digest/Reference/cadeia não validados; falsa sensação de segurança | XMLDSig completo: canonicalização, digest, referência, algoritmo e confiança |
| FISC-08 | P1 | NFS-e com alíquotas/regime fixos e código de verificação `Math.random` | `src/lib/nfse/nfse-service.ts:93-120`; `api/nfse/route.ts:151-156` | Cálculo fiscal errado; código previsível | Regras por município/regime; código conforme provedor; CSPRNG quando aplicável |
| FISC-09 | P1 | NF-e manual confia em valores/impostos do cliente e não valida tenant de peças | `src/app/api/nfe/manual/route.ts:82-180` | Valores fiscais arbitrários; vínculo cross-tenant | Recalcular no servidor; validar todas as FKs por office; transação |
| FISC-10 | P1 | Endpoints SEFAZ por UF hardcoded e possivelmente desatualizados | `src/lib/sefaz/endpoints.ts` | Falha de conexão/autorização | Tabela versionada conforme MOC; healthcheck por UF/ambiente |
| FISC-11 | P2 | SPED inclui NFS-e no bloco D sem validar obrigatoriedade/perfil | `sped-generator.ts:785-870` | Escrituração incorreta para oficinas de serviço | Regras por perfil/UF; validação contábil |

**Sondas:** FISC-01, FISC-03, FISC-04 reproduzidas. O registro 0200 não possui campos de quantidade/valor de inventário e COD_GEN não é CFOP; o guia prático da EFD define o layout [2](http://sped.rfb.gov.br/arquivo/download/3050).

### E. Operação, qualidade e compliance

| ID | Sev. | Achado | Evidência | Impacto | Correção mínima |
|---|---|---|---|---|---|
| OPS-01 | P0 | Sem migrations versionadas; scripts antigos usam SQLite e caminho `/home/z` | `prisma/` sem `migrations/`; `.zscripts/build.sh`; `download/setup-local.sh` | Deploy não reproduzível; risco de perda de dados | Migrations Prisma versionadas; deploy com `migrate deploy`; remover scripts obsoletos |
| OPS-02 | P0 | Build não validado; Docker/start divergem npm/bun; healthcheck não verifica DB | `Dockerfile`; `package.json`; `next.config.ts`; `src/app/layout.tsx` | Imagem pode não subir ou parecer saudável sem banco | Build reproduzível offline; um runtime; health/ready com DB |
| OPS-03 | P1 | 32 vulnerabilidades npm (12 em produção: 1 critical, 11 high) | `audit/evidence/npm-audit-runtime.json` | Superfície de ataque em Next, node-forge, sharp, Prisma, zod | Atualizar/mitigar; `npm audit` no CI; SBOM |
| OPS-04 | P1 | Testes existentes não cobrem APIs/tenant/concorrência; suíte de segurança falha por engine | `src/__tests__/`; `vitest.config.ts`; `scripts/audit-critical-tests.ts` fora do include | Falsa sensação de cobertura | Testes de integração com PostgreSQL real; E2E; concorrência; contrato fiscal |
| OPS-05 | P1 | Lint com 3 erros (Hooks condicionais, require) e 26 warnings | `audit/evidence/lint-src.log` | Bugs de UI e build bloqueado em CI estrito | Corrigir erros; tipar React/Node; lint no CI |
| OPS-06 | P1 | Rate limit e filas em memória; não funcionam com múltiplas instâncias | `src/lib/rate-limiter.ts`; `src/lib/sefaz/import-queue.ts` | Bypass de limites e perda de jobs em restart/scale | Redis/fila persistente; limites distribuídos |
| OPS-07 | P1 | Logs/auditoria sem trilha imutável; LGPD anonimização com valores iguais por office | `src/lib/auth.ts:457-489`; `api/auth/gdpr-delete/route.ts` | Auditoria frágil; reidentificação | Audit log append-only; política de retenção; anonimização irreversível |
| OPS-08 | P2 | IA envia contexto financeiro/estoque a provedor externo sem consentimento explícito | `src/app/api/ai/chat/route.ts:132-232` | Risco LGPD e custo não controlado | Opt-in, minimização, contrato DPA, entitlement e orçamento |
| OPS-09 | P2 | E-mail e WhatsApp não configurado são marcados como enviados/simulados | `src/app/api/notifications/send/route.ts:136-156` | Usuário acredita que notificou cliente | Status SIMULADO/NÃO_CONFIGURADO; não marcar ENVIADA |

---

## 4. Matriz por módulo

| Módulo | Existe | Pronto para produção? | Principal bloqueio |
|---|---|---|---|
| Auth/tenant | Sim | **Não** | SEC-01/02/03/06/07 |
| Clientes/veículos/fornecedores | Sim | Parcial | Validação de FKs e limites de plano |
| Ordens de serviço | Sim | **Não** | SEC-01, BIZ-11, numeração |
| PDV/vendas | Sim | **Não** | BIZ-01/02/05/06/08 |
| Estoque | Sim | **Não** | BIZ-02/03/04 |
| Financeiro/caixa | Sim | **Não** | BIZ-07/09/12 |
| Assinaturas/billing | Sim | **Não** | PAY-01..07 |
| Mercado Pago | Sim | **Não** | PAY-01/02/03/06 |
| NF-e/SEFAZ | Parcial | **Não** | SEC-04, FISC-04..10 |
| NFS-e | Parcial | **Não** | FISC-01/08 |
| SPED | Parcial | **Não** | FISC-03/11 |
| WhatsApp/IA | Sim | Parcial | SEC-05, OPS-08/09 |
| Deploy/observabilidade | Parcial | **Não** | OPS-01/02/06 |

---

## 5. Plano priorizado para produção

### Fase 0 — Conter riscos e tornar o build reproduzível (1–2 semanas)

- Congelar uso com dados reais; desabilitar NFS-e/SPED/importação assíncrona até corrigir.
- Corrigir SEC-01/02/03/04/05 e PAY-01/02/04.
- Unificar serviço de venda/estoque/financeiro com transações e idempotência.
- Migrations versionadas; CI com `npm ci`, typecheck, lint, testes e build.
- Remover Google Fonts do build ou self-host; alinhar Docker/start.
- Atualizar dependências críticas/high.

**Critério de saída:** nenhum P0 aberto; build e migrations passam em CI; teste cross-tenant negativo.

### Fase 1 — Integridade comercial e billing (2–4 semanas)

- Corrigir BIZ-01..12 e PAY-03/05/06/07/08.
- Ledger de estoque e financeiro; estornos explícitos; conciliação MP.
- Entitlements transacionais; contadores de plano.
- Testes de concorrência com PostgreSQL real (duas vendas, pagamento+cancelamento, refresh duplo).

**Critério de saída:** saldo de estoque = soma de movimentos; financeiro concilia com vendas; nenhum plano pago ativa sem pagamento.

### Fase 2 — Fiscal real (3–6 semanas, com contador)

- Separar rascunho/RPS de documento autorizado.
- Integrar emissão/consulta/cancelamento NF-e/NFS-e; validar XMLDSig completo.
- Reescrever SPED conforme layout vigente e validar no PVA.
- Worker persistente para importação/manifestação; endpoints SEFAZ versionados.
- Homologação com certificados e municípios piloto.

**Critério de saída:** documentos autorizados pelo órgão; SPED aceito no PVA; nenhum status fiscal fictício.

### Fase 3 — Operação e escala (2–4 semanas)

- Redis/filas distribuídas; rate limit global; storage externo para uploads/certificados.
- Observabilidade: logs estruturados, métricas, traces, alertas, backup/restore testado.
- LGPD: consentimento, retenção, anonimização, DPA com provedores.
- E2E, carga, pentest interno, runbooks e rollback.

**Critério de saída:** SLO definido, restore testado, pentest sem P0/P1, on-call e runbooks.

> Estimativas são ordem de grandeza para um time pequeno (2–4 devs + contador/consultor fiscal). Não são promessa de data.

---

## 6. Critérios objetivos de “pronto para produção”

- [ ] Build, lint, typecheck e testes passam em CI limpo, sem rede externa no build.
- [ ] Migrations versionadas e `migrate deploy` ensaiado em staging.
- [ ] Testes negativos de tenant: office A não lê/escreve dados do office B em nenhuma rota.
- [ ] Estoque nunca negativo; saldo bate com ledger; concorrência não perde atualização.
- [ ] Venda/pagamento/cancelamento são idempotentes e atômicos.
- [ ] Mercado Pago valida assinatura oficial, valor, moeda e referência; refund estorna.
- [ ] Plano pago só ativa após pagamento; limites enforced no servidor.
- [ ] Nenhum documento fiscal marcado EMITIDA/CANCELADA sem resposta do órgão.
- [ ] SPED aceito no PVA; XMLDSig validado completamente.
- [ ] TLS validado; sem SSRF; tokens fora de localStorage; sessões revogáveis.
- [ ] Backup/restore testado; healthcheck verifica DB; filas sobrevivem a restart.
- [ ] `npm audit` sem critical/high em produção ou mitigações documentadas.
- [ ] LGPD: consentimento, retenção, anonimização e DPA.

---

## 7. Evidências executadas

| Comando/ação | Resultado |
|---|---|
| `npx tsc --noEmit --incremental false` (tipos Prisma gerados offline) | **0 erros** (`audit/evidence/typecheck.log`) |
| `npx eslint src` | **3 erros, 26 warnings** (`audit/evidence/lint-src.log`) |
| `npm run build` | **Falhou** por Google Fonts inacessível (`audit/evidence/build.log`) |
| `npx vitest run src/__tests__/` | 79 testes passaram, **1 erro não tratado** de engine Prisma; não é suíte verde (`audit/evidence/tests-offline.log`) |
| `npx vitest run --config audit/vitest.config.ts` | **18 sondas passaram** reproduzindo defeitos (`audit/evidence/probes.log`) |
| `npm audit --omit=dev --json` | **12 vulnerabilidades** (1 critical, 11 high) (`audit/evidence/npm-audit-runtime.json`) |
| Schema Prisma via WASM `getDMMF` | 36 modelos carregados sem erro de schema |

**Importante:** as 18 sondas são testes de caracterização de defeitos. Elas devem ser substituídas por testes de aceitação que exijam o comportamento seguro após as correções.

---

## 8. Referências externas

1. Mercado Pago Developers — Webhooks: manifesto oficial `id:[data.id];request-id:[x-request-id];ts:[ts];` e validação HMAC. [1](https://www.mercadopago.com.br/developers/en/docs/checkout-api/additional-content/your-integrations/notifications/webhooks)
2. Receita Federal — Guia Prático EFD-ICMS/IPI: layout dos registros 0100, 0200 e demais. [2](http://sped.rfb.gov.br/arquivo/download/3050)

---

## 9. Nota final

O KiteOS já cobre um escopo funcional relevante para oficinas, mas a distância até produção está em **confiabilidade transacional, isolamento multi-tenant e verdade fiscal**, não em quantidade de features. Recomenda-se tratar as Fases 0–2 como pré-requisito inegociável antes de vender ou operar com dados reais.
