# Implementação — Passo 5: módulo fiscal (status verdadeiros e layout do SPED)

> **Escopo atacado:** FISC-01, FISC-02, FISC-03, FISC-04, parte de FISC-08 e
> NOT-01/SEC-14 — os quatro defeitos que as sondas 14–17 ainda reproduziam.
>
> **Estado:** implementado e executado. CI run
> [`43540255108`](https://github.com/marcio1fs/kiteos/actions/runs/43540255108)
> (commit `29a2581`): 4 jobs `success`, **aceitação 158/158**, **integração 20/20
> em PostgreSQL 17**, typecheck 0 erros, lint 0 erros.
> Evidências: `audit/evidence/ci-run-43540255108.log`,
> `audit/evidence/probes-pos-passo5.log`, `audit/evidence/testes-locais-passo5.log`.
>
> **O que este passo NÃO entrega — e não pode entregar daqui:** homologação com
> prefeitura e SEFAZ, validação do SPED no PVA e adapter concreto de provedor de
> NFS-e. Ver seção 9. Nada abaixo deve ser lido como "o sistema emite NF-e/NFS-e".

---

## 1. O defeito de fundo: o sistema afirmava o que não aconteceu

Quatro caminhos gravavam um desfecho que nenhuma autoridade externa tinha
confirmado:

| Sonda | O que acontecia | Efeito |
| --- | --- | --- |
| 16 · FISC-01 | `POST /api/nfse` gravava `status: 'EMITIDA'` e gerava `codigoVerificacao` com `Math.random` | Documento fiscal fictício, com cara de oficial e código previsível |
| — · FISC-02 | `ClientInvoice` criada `EMITIDA` e cancelada `CANCELADA` sem SEFAZ | Nota de venda "autorizada" sem protocolo nem chave validada |
| 14 · FISC-04 | `processImportJob` "executava" cinco etapas que só moviam um número de progresso e marcava `COMPLETED` | Usuário acredita que a NF-e foi importada; nada foi consultado, baixado ou gravado |
| 15 · NOT-01 | E-mail sem provedor era gravado `ENVIADA` (`EMAIL_SIMULATED`, `success: true`) | Histórico afirma uma entrega inexistente |
| 17 · FISC-03 | SPED com `0100` fabricado, `0200` em layout incompatível e `H010` com valores deslocados | Arquivo rejeitado pelo PVA; escrituração inválida |

Em comum: **o status era escrito por quem não tinha autoridade para escrevê-lo.**
A correção, portanto, não é trocar um valor por outro — é tornar o status
estruturalmente dependente de uma resposta externa.

## 2. A porta: `EMITIDA` só existe mediante prova

`src/lib/fiscal/document-status.ts` define o ciclo de vida real e os únicos
produtores do status autorizado:

```
RPS / RASCUNHO  ->  criado localmente. NÃO é documento fiscal.
EMITIDA         ->  autorizado pelo órgão. Exige AuthorizationProof.
CANCELADA       ->  cancelamento autorizado. Exige prova
                    (exceto para o que nunca foi transmitido).
```

```ts
export type AuthorizationProof = {
  protocol: string;                      // protocolo SEFAZ ou número/protocolo municipal
  verificationCode?: string | null;      // código de verificação: vem do município
  environment: 'HOMOLOGACAO' | 'PRODUCAO';
  authorizedAt: Date;
  raw?: string | null;
};

export function issuedNfseData(proof) {           // único produtor de 'EMITIDA' p/ NFS-e
  const authorized = assertAuthorized(proof, 'NFS-e');
  return { status: NFSE_ISSUED_STATUS, codigoVerificacao: authorized.verificationCode?.trim() || null, … };
}
```

`assertAuthorized` recusa prova ausente, `null`, com protocolo vazio ou só com
espaços (`409 NOT_AUTHORIZED`). `issuedInvoiceData` additionally exige chave de
acesso de 44 dígitos — uma "autorização" sem chave é resposta inválida, não
sucesso.

Isto é o que torna a regressão difícil: nenhum caminho consegue marcar como
emitido por acidente, porque a string `'EMITIDA'` para documento fiscal só sai
dessas duas funções, e elas não devolvem nada sem prova.

## 3. NFS-e: RPS → transmissão → EMITIDA (FISC-01, FISC-08)

**Criação** (`POST /api/nfse` e `POST /api/nfse/from-os`) agora grava
`status: 'RPS'` e `codigoVerificacao: null`. O código de verificação é emitido
pelo município; gerá-lo localmente com `Math.random` fabricava documento
(`FISC-08`). A resposta diz o que é:

```json
{ "success": true, "transmitted": false,
  "warning": "RPS 000001 criado. Não é documento fiscal: transmita em POST /api/nfse/{id}/transmitir …" }
```

**Alíquota de ISS.** `Number(aliqIssqn) || ALIQ_ISSQN_PADRAO` chutava 5% quando o
cliente não informava nada — cálculo fiscal errado e silencioso. A constante
`ALIQ_ISSQN_PADRAO` foi removida: sob regime `ISSQN` a alíquota é obrigatória e a
ausência vira `NaN`, recusado por `validateNfseData` com `400`. Alíquota zero
explícita (isenção) continua aceita, porque `0 || 5` era justamente a armadilha.

**Transmissão** (`POST /api/nfse/{id}/transmitir`, nova): `transmitNfse()` resolve
o provedor da oficina, chama `provider.transmit(xml)` e só então grava `EMITIDA`
com o protocolo e o código devolvidos. A transição usa CAS
(`updateMany where status = 'RPS'`), então duas transmissões simultâneas não
marcam duas vezes; retry encontra `EMITIDA` e devolve `alreadyTransmitted: true`
sem chamar o provedor de novo. Auditoria `NFSE_TRANSMITTED` com provedor,
protocolo, código e ambiente.

**Sem provedor** — que é o caso hoje — a rota responde
`501 PROVIDER_NOT_INTEGRATED` e o documento **continua RPS**. O sistema diz que
não integrou em vez de fingir.

**Cancelamento.** `cancelNfse()` separa os dois casos: RPS nunca transmitido é
descartado localmente (não há autorização a desfazer; auditoria
`NFSE_RPS_DISCARDED`); NFS-e autorizada só cancela com `provider.cancel()` e prova
(`NFSE_CANCELLED`). O `DELETE /api/nfse/{id}` passou a exigir motivo real — antes o
próprio front enviava `"Cancelamento solicitado pelo usuario"` fabricado.

**Regime federal.** `calculateIssqn` assume lucro presumido (PIS 0,65%, COFINS 3%,
IR 4,8%, CSLL 1%, INSS 11%). Não há campo de regime por oficina no schema, então a
premissa deixou de ser implícita: `IssqnCalculation.regimeFederal` carrega
`'LUCRO_PRESUMIDO'` e vai para a trilha de auditoria. **Confirmar com o contador**
(§9).

## 4. Nota de venda: RASCUNHO até a SEFAZ autorizar (FISC-02)

`POST /api/client-invoices` (venda e OS) grava `INVOICE_DRAFT_STATUS`
(`'RASCUNHO'`) e `protocoloAutorizacao: null`. A chave de acesso continua
pré-calculada — ela é derivada de UF/data/CNPJ/modelo/série/número e serve para
conferir depois, mas **não é prova de nada**.

`POST /api/client-invoices/{id}/cancel` usa `cancelledInvoiceData()`: rascunho é
descartado localmente (`transmitted: false`, auditoria `NFE_DRAFT_DISCARDED`); nota
autorizada exige prova de cancelamento e, sem integração, responde `409/501` em vez
de gravar um cancelamento fictício.

## 5. Fila de importação: trabalho real ou falha real (FISC-04)

O núcleo foi extraído da rota para `src/lib/sefaz/nfe-import.ts`
(`importNfeByChave`), e **rota síncrona e job assíncrono chamam o mesmo código** —
é isso que impede a fila de declarar conclusão sem importar. Sequência real:
certificado ativo da oficina → `consultaProtocolo` (registrado em `sefazConsultas`
aconteça o que acontecer) → bloqueio se `CANCELADA/DENEGADA/INUTILIZADA` →
`downloadNfe` → validação e parse do XML → fornecedor → `invoice` + itens →
recepção `PENDENTE` → auditoria.

`processImportJob` agora termina assim:

| Situação | Status do job |
| --- | --- |
| `importNfeByChave` devolveu nota persistida | `COMPLETED`, `progress 100`, `result.invoiceId` |
| Falha de negócio (sem certificado, não autorizada, XML inválido) | `FAILED` + `failureCode` (`CERTIFICADO_AUSENTE`, `NFE_NAO_AUTORIZADA`, `XML_INDISPONIVEL`, `XML_INVALIDO`, `XML_PARSE_ERROR`, `ALREADY_IMPORTED`, `UF_INDETERMINADA`) |
| Exceção inesperada | `FAILED` + `INTERNAL_ERROR` com a mensagem real |

**Limitação honesta, ainda aberta:** o store continua em memória (`Map` +
`setTimeout`). Jobs se perdem em restart/deploy e não há retry, backoff ou
coordenação entre instâncias. Uma fila persistente (BullMQ ou similar) segue
pendente; o que sobrevive a restart é o registro durável em `sefazConsultas` e
`invoices`, que o núcleo grava independentemente do job.

## 6. SPED: layout contra o Guia Prático (FISC-03, sonda 17)

**Registro 0100 — contabilista.** Era `|0100|CONTADOR||||||9999|`: nome inventado,
CPF/CRC/e-mail ausentes, CRC fictício. Um arquivo assim assina uma escrituração em
nome de alguém que não existe. Agora `SpedContabilista` é **entrada obrigatória** e
validada (nome ≥ 3, CPF com 11 dígitos, CRC não vazio, e-mail válido); sem ela a
geração retorna `success: false` e a rota responde `400`. Os 13 campos do guia são
emitidos na ordem: `REG, NOME, CPF, CRC, CNPJ, CEP, ENDERECO, NUM, COMPL, BAIRRO,
FONE, FAX, EMAIL`.

**Registro 0200 — identificação do item.** A lista anterior era incompatível:
CFOP na posição de `COD_GEN`, CST na de `ALIQ_ICMS`, CSOSN na de `CEST` e dois
campos que não existem (`QTD_INV`, `VAL_INV` — quantidade e valor de estoque são do
bloco H). Corrigido para os 13 campos vigentes:

```
REG · COD_ITEM · DESCR_ITEM · COD_BARRA · COD_ANT_ITEM · UNID_INV · TIPO_ITEM
    · COD_NCM · COD_EX_IPI · COD_GEN · COD_LST · ALIQ_ICMS · CEST
```

- `COD_GEN` = dois primeiros dígitos do NCM (gênero, tabela 4.2.1) — **não** é CFOP.
- `ALIQ_ICMS` vem de `TaxRule` ativa da oficina por NCM; sem regra configurada o
  campo sai vazio, nunca inventado.
- `TIPO_ITEM` = `'00'` (mercadoria para revenda).
- CFOP/CST/CSOSN não pertencem ao cadastro do item: ficam nos itens de documento
  fiscal (C170/C190).
- `COD_BARRA` e `COD_EX_IPI` saem vazios porque **`Part` não tem essas colunas** no
  schema (a sonda usava um mock que as tinha). Preencher exigiria migration —
  registrado como aberto (§10).

**Registro H010 — inventário físico.** A ordem dos campos estava certa; os valores
estavam deslocados. `UNID` saía vazio, `QTD` recebia a unidade, `VL_UNIT` recebia a
quantidade, `VL_ITEM` recebia o custo unitário (e não o total) e `IND_PROP`, que é
obrigatório, ia vazio. Agora, conforme o guia (11 campos, decimais 3/6/2):

```
|H010|P1|UN|2,000|10,000000|20,00|0||||20,00|
       COD_ITEM UNID QTD    VL_UNIT   VL_ITEM IND_PROP … VL_ITEM_IR
```

`VL_ITEM = QTD × VL_UNIT`, `IND_PROP = '0'` (próprio e em seu poder), `COD_PART`
vazio (só é obrigatório com `IND_PROP` 1 ou 2), `COD_CTA` vazio (obrigatório só nos
perfis A e B) e `VL_ITEM_IR = VL_ITEM` sem ajustes do RIR/99. Os testes também
conferem a coerência exigida pelo guia: a unidade do `H010` existe no `0190` e
coincide com o `UNID_INV` do `0200`.

## 7. Notificações: simulado não é enviado (NOT-01, sonda 15)

`sendResult` ganhou `notIntegrated`, que separa *"tentamos entregar e falhou"* de
*"não existe integração para tentar"*:

| Caso | Status gravado | `success` / `delivered` |
| --- | --- | --- |
| Provedor aceitou a entrega | `ENVIADA` + `sentAt` | `true` |
| Sem provedor (e-mail hoje; WhatsApp sem configuração) | **`PENDENTE`** | `false` + `notIntegrated: true` |
| Tentativa real que falhou | `FALHOU` | `false` |
| Tipo `SYSTEM` (entrega é exibir no app) | `ENVIADA` | `true` |

O método passou de `EMAIL_SIMULATED`/`WHATSAPP_SIMULATED` para
`EMAIL_NAO_INTEGRADO`/`WHATSAPP_NAO_INTEGRADO`. `ENVIADA` sem `sentAt` já era
recusado por `PUT /api/notifications/{id}`; agora o caminho de criação também não a
produz sem entrega.

## 8. Interface

- Badge novo **"RPS · não transmitida"** (âmbar) e fim do fallback
  `NFS_STATUS_CONFIG[status] || NFS_STATUS_CONFIG.EMITIDA`, que exibia **qualquer
  status desconhecido como "Emitida"** — o mesmo defeito, agora na tela. Status não
  mapeado mostra o valor cru.
- Botão **"Transmitir"** no detalhe do RPS, com o aviso "RPS ainda não transmitido:
  não é documento fiscal", e rótulo do cancelamento trocando para
  **"Descartar RPS"** nesse estado.
- O motivo do cancelamento é perguntado ao operador (`prompt`, mínimo 3 caracteres)
  em vez de ser fabricado pelo front.

## 9. O que **não** foi validado — e por quê

Nada aqui substitui homologação externa. Explicitamente:

1. **Nenhum documento foi autorizado por órgão fiscal.** Não há adapter concreto de
   provedor de NFS-e (ABRASF/Ginfes/Focus/Betha/ISS.net…) nem de emissão NF-e: a
   porta existe e está testada com stub injetado, o adaptador real exige município
   piloto, certificado A1 real e credenciamento. Hoje toda transmissão responde
   `501 PROVIDER_NOT_INTEGRATED`.
2. **O SPED não foi validado no PVA.** Os registros `0100`, `0200` e `H010` foram
   conferidos campo a campo contra o Guia Prático da EFD-ICMS/IPI e têm testes, mas
   o arquivo inteiro **não** foi submetido ao PVA. Os demais registros e blocos
   (C/D/E, `0150`, obrigações por perfil/UF) não foram revisados neste passo —
   FISC-11 (NFS-e no bloco D sem validar obrigatoriedade/perfil) segue aberto.
3. **Cálculo tributário não foi revisado por contador.** Alíquotas de ISS por
   município/item, regime federal (a premissa de lucro presumido está agora
   explícita, não corrigida), retenções e CST/CSOSN por operação continuam
   dependendo de validação contábil.
4. **Nenhum e-mail foi enviado** (não há provedor) e **nenhuma importação SEFAZ real
   ocorreu** neste ambiente (sem certificado e sem rede para a SEFAZ). Os testes
   exercitam esses caminhos com dependências injetadas/stub.
5. **A fila continua em memória** (§5) e a UI foi verificada por typecheck/lint, não
   em navegador.

## 10. Testes e execução real

**Novos testes de aceitação — 32 (158 no total):**

- `fiscal-honesty.test.ts` (24): criação gera RPS sem código e avisa; ISS sem
  alíquota → `400` e nada gravado; alíquota zero explícita aceita; sem provedor →
  `501` e RPS permanece RPS (lib e rota); com provedor → `EMITIDA` + código do
  município + CAS + auditoria; provedor sem protocolo → `409` e nenhuma escrita;
  retry idempotente sem chamar o provedor; perdedor do CAS → `409`; descarte de RPS;
  autorizada não cancela sem integração; motivo curto recusado antes do banco;
  `DELETE` sem motivo → `400`; `issuedInvoiceData` exige prova e chave de 44;
  rascunho descartado × autorizada exigindo prova; e-mail/WhatsApp sem provedor
  ficam `PENDENTE`; WhatsApp com API ok segue `ENVIADA`; `SYSTEM` é entrega real;
  fila `FAILED` com código real, `COMPLETED` só com `invoiceId`, exceção não vira
  sucesso; prova ausente/vazia recusada e código de verificação ausente vira `null`.
- `sped-layout.test.ts` (8): `0100` recusado sem contabilista e com CPF/CRC/e-mail
  inválidos; `0100` com 13 campos reais (e sem `CONTADOR`/`9999`); `0200` com 13
  campos, `COD_GEN` do NCM, `ALIQ_ICMS` da `TaxRule`, sem CFOP/CST/CSOSN/estoque;
  `COD_GEN` vazio sem NCM; `ALIQ_ICMS` vazio sem regra; `H010` campo a campo;
  coerência `0190` × `0200` × `H010`.

**Sondas:** as quatro do módulo fiscal (14 fila, 15 e-mail, 16 NFS-e, 17 SPED)
**passaram a falhar** — pela convenção invertida, defeitos corrigidos. Resultado
atual: **17 falham / 1 passa**, e a que passa é a sonda obsoleta do webhook do
Mercado Pago (`audit/STATUS-SONDAS.md`). Evidência:
`audit/evidence/probes-pos-passo5.log`.

| Verificação | Onde | Resultado |
| --- | --- | --- |
| `npm run typecheck` | sandbox | exit 0 |
| `npm run lint` | sandbox | 0 erros / 26 warnings (pré-existentes) |
| `npm run test:acceptance` | sandbox | **158/158** em 13 arquivos |
| `npx vitest run src/__tests__/` | sandbox | **237/237** em 20 arquivos |
| Aceitação | CI `43540255108` | **158/158** |
| Integração PostgreSQL 17 | CI `43540255108` | **20/20** |
| Build / imagem Docker | CI `43540255108` | `success`; `node v22.23.5 \| /app 156.1M` |
| Gate de drift | CI `43540255108` | `success` — **sem migration nova** |

Nenhum teste de integração novo foi necessário: as mudanças deste passo são de
estado e layout, e não tocam invariantes de concorrência em banco. Os 20 testes de
integração existentes continuam verdes contra PostgreSQL 17.

## 11. Arquivos

**Novos:** `src/lib/fiscal/document-status.ts` · `src/lib/fiscal/provider.ts` ·
`src/lib/fiscal/nfse-transmission.ts` · `src/lib/sefaz/nfe-import.ts` ·
`src/app/api/nfse/[id]/transmitir/route.ts` ·
`src/__tests__/acceptance/fiscal-honesty.test.ts` ·
`src/__tests__/acceptance/sped-layout.test.ts`

**Alterados:** `src/app/api/nfse/route.ts` · `src/app/api/nfse/from-os/route.ts` ·
`src/app/api/nfse/[id]/route.ts` · `src/app/api/client-invoices/route.ts` ·
`src/app/api/client-invoices/[id]/cancel/route.ts` ·
`src/app/api/notifications/send/route.ts` · `src/app/api/sefaz/importar/route.ts` ·
`src/app/api/fiscal/sped/route.ts` · `src/lib/nfse/nfse-service.ts` ·
`src/lib/nfse/index.ts` · `src/lib/sefaz/import-queue.ts` ·
`src/lib/sped/sped-generator.ts` · `src/lib/sped/index.ts` ·
`src/components/modules/fiscal.tsx`

## 12. O que continua aberto no módulo fiscal

- **Homologação externa** (§9): município piloto + certificado A1 para NFS-e,
  credenciamento/ambiente de homologação para NF-e, validação do SPED no PVA com
  contador. **É o que falta para o critério de saída da Fase 2 do relatório**
  ("documentos autorizados pelo órgão; SPED aceito no PVA"). O terceiro item do
  critério — *nenhum status fiscal fictício* — está implementado e testado.
- **FISC-04 (resto):** fila persistente com retry/backoff e coordenação entre
  instâncias.
- **FISC-05:** manifestação `PENDENTE` bloqueia reenvio; sem unique/lock por
  chave+tipo+sequência.
- **FISC-06:** manifestação pode enviar XML não assinado; `nSeqEvento` fixo em 1.
- **FISC-07:** verificador XML só valida RSA-SHA1 do `SignedInfo` — falta
  canonicalização, digest, referência e cadeia de confiança.
- **FISC-09:** NF-e manual confia em valores/impostos enviados pelo cliente e não
  valida o tenant das peças.
- **FISC-10:** endpoints SEFAZ por UF hardcoded, sem healthcheck.
- **FISC-11:** NFS-e no bloco D sem validar obrigatoriedade/perfil.
- **Regime tributário por oficina** (Simples Nacional × lucro presumido × real) e
  **alíquotas de ISS por município/item** não são configuráveis.
- **`Part` não tem `barcode` nem `exIpi`**, então `COD_BARRA` e `COD_EX_IPI` saem
  vazios no `0200`; preencher exige migration.
- **Provedor de e-mail** (SendGrid/SES/SMTP) não integrado.
- Fora do módulo fiscal, seguem abertos: **BIZ-12** (unicidade
  `(officeId, sourceType, sourceId, event)` em `FinancialEntry`),
  `src/lib/numbering.ts` (`generateNextNumber` não atômico), allowlist SEFAZ
  `.gov.br` no `mtls-client` e o **passo 6** (configuração/segredos).
