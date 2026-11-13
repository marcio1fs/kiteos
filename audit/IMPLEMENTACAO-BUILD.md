# Implementação — Passo 2: build e empacotamento

Escopo: item **2** do `RELATORIO-AUDITORIA.md` — "`next build` depende de Google Fonts, o
`start` usa `bun` sem `bun` no Dockerfile; alinhar Dockerfile/CI e validar `next build`".
Conforme escolha do usuário ("2"). Nenhum outro item do roadmap foi tocado.

Estado: **implementado e executado** neste sandbox (build offline + servidor standalone no ar)
e **validado no GitHub Actions** — ver seção 5.

---

## 1. Defeito 1 — o build de produção não existia offline

`src/app/layout.tsx` usava `next/font/google`, que baixa Geist e Geist Mono de
`fonts.gstatic.com` **em todo build**. Reproduzido neste sandbox (que não tem acesso a esse
host), `audit/evidence/build-falha-google-fonts.log`:

```
$ NEXT_TELEMETRY_DISABLED=1 npx next build
> Build error occurred
Error: Turbopack build failed with 2 errors:
[next]/internal/font/google/geist_a71539c9.module.css
next/font: error:
Failed to fetch `Geist` from Google Fonts.
  Import trace:
    Server Component:
      [next]/internal/font/google/geist_a71539c9.module.css
      [next]/internal/font/google/geist_a71539c9.js
      ./src/app/layout.tsx
...
Failed to fetch `Geist Mono` from Google Fonts.
exit=1
```

Não é só um problema de sandbox: qualquer build em rede instável, CI com egresso restrito ou
ambiente air-gapped quebra, e o resultado não é reproduzível (a fonte vem de um host externo no
momento do build).

**Correção:** pacote `geist@1.9.2` (oficial da Vercel), que traz os `.woff2` versionados no npm
e usa `next/font/local` — ou seja, zero rede no build:

```tsx
import { GeistSans } from "geist/font/sans";   // localFont({ src: "./fonts/geist-sans/Geist-Variable.woff2",
import { GeistMono } from "geist/font/mono";   //               variable: "--font-geist-sans", weight: "100 900" })
...
<body className={`${GeistSans.variable} ${GeistMono.variable} antialiased ...`}>
```

As variáveis CSS expostas pelo pacote são **exatamente** `--font-geist-sans` e
`--font-geist-mono`, que é o que `src/app/globals.css` já consumia (`--font-sans`,
`--font-mono`). Nenhum CSS precisou mudar e o resultado visual é o mesmo (Geist variável,
pesos 100–900).

Verificado: build **exit 0 offline** e as fontes saem empacotadas no próprio build —
`audit/evidence/build-offline-sucesso.log`:

```
✓ Compiled successfully in 11.7s
.next/static/media/Geist_Variable-s.p.43azbxi7zpibd.woff2       (69.488 bytes)
.next/static/media/GeistMono_Variable.p.2vtemngyy8z-u.woff2     (71.212 bytes)
```

---

## 2. Defeito 2 — `npm start` exigia `bun`, que ninguém instala

```
"start": "NODE_ENV=production bun .next/standalone/server.js 2>&1 | tee server.log"
```

`bun` não está no `Dockerfile`, não está no CI e não é uma dependência declarada: `npm start`
falhava em qualquer máquina sem bun instalado à mão. O `CMD` da imagem já estava certo
(`["node", "server.js"]`), então container e script divergiam.

**Correção:**

```
"start": "NODE_ENV=production node .next/standalone/server.js"
```

O `| tee server.log` saiu junto: em produção o log vai para stdout, e o container já captura.
`build` foi mantido **exatamente** como era (`next build` + cópias de `.next/static` e `public`
para dentro de `.next/standalone`) — uma tentativa de separá-lo em `build:standalone` foi
revertida porque o `npm start` local depende dessas cópias.

Verificado de ponta a ponta, com o servidor no ar (`audit/evidence/standalone-smoke.log`):

```
$ npm start
▲ Next.js 16.2.12
- Local:   http://localhost:3000
- Network: http://0.0.0.0:3000
✓ Ready in 0ms

GET /                                  -> 200, 11.835 bytes
GET /_next/static/media/Geist_*.woff2  -> 200, font/woff2, 69.488 bytes
GET /api/subscriptions/check           -> 401 {"success":false,"error":"Token de autenticação não fornecido"}
```

O 401 é o comportamento correto: sem banco e sem o engine do Prisma neste sandbox, o guard de
autenticação responde antes de qualquer query — a rota carrega e o empacotamento está íntegro.
O `server.js` gerado usa `process.env.HOSTNAME || '0.0.0.0'`, então a imagem escuta fora do
container sem configuração extra (conferido no arquivo gerado, não assumido).

---

## 3. Dockerfile

- **`node:20-alpine` → `node:22-alpine`** nos três estágios. Node 20 entrou em fim de vida em
  **2026-04-30**; a imagem base estava num runtime sem manutenção. O CI já usa Node 22
  (`NODE_VERSION: '22'`), então build e imagem agora coincidem.
- Comentário no `CMD` deixando explícito que **migrations são passo de release**, não de start:
  o estágio `runner` carrega só a saída standalone traçada, sem o CLI do Prisma, então
  `prisma migrate deploy` roda antes do rollout (job de migração ou init container).

---

## 4. Achado novo: o file tracer embarca o projeto inteiro

Medido no build local: `.next/standalone` = **77–79 MB**, contendo `src/` (2,6 MB), `audit/`
(176 KB), `examples/`, `agent-ctx/`, `download/`, `upload/`, `scripts/`, `docker/`,
`Caddyfile`, `bun.lock`, `worklog.md` e uma dezena de shell scripts soltos
(`daemon.sh`, `server-watchdog.py`, `kiteos-daemon.sh`…). O aviso do build nomeia a causa:

```
Turbopack build encountered 1 warnings:
Encountered unexpected file in NFT list
A file was traced that indicates that the whole project was traced unintentionally.
Import trace:
  App Route:
    ./next.config.ts
    ./src/app/api/uploads/logos/[filename]/route.ts
```

As rotas de logo resolvem caminhos em tempo de execução (`process.cwd()` + nome de arquivo
dinâmico, com um fallback `path.resolve(cwd, '..', '..')`), e o tracer não consegue escopar a
expressão — então puxa tudo.

**Duas correções sugeridas pelo próprio aviso foram tentadas e medidas; nenhuma funciona com o
build Turbopack:**

| Tentativa | Resultado |
| --- | --- |
| `path.join(/* turbopackIgnore: true */ cwd, ...)` nas 4 expressões | aviso idêntico, 77 MB idênticos |
| `outputFileTracingExcludes` no `next.config.ts` com 20 globs | aviso idêntico, 77 MB idênticos, nenhum arquivo excluído |

Ambas foram **revertidas** — ficar com código e configuração inócuos seria pior do que não os
ter. Sobrou um comentário no ponto exato (`src/app/api/uploads/logos/[filename]/route.ts`)
registrando que os dois mecanismos foram medidos e são ignorados aqui.

**O que funciona:** manter esses caminhos **fora do contexto de build**. O `.dockerignore`
recebeu `.github`, `.zscripts`, `agent-ctx`, `audit`, `docker`, `download`, `examples`,
`scripts`, `src/__tests__`, `upload`, `Caddyfile`, `bun.lock`, `docker-compose.yml`, `*.py`,
`*.sh` e os configs de teste. Se não entra no contexto, o tracer não tem o que puxar. É seguro:
`tsconfig.json` já exclui `examples`, `agent-ctx`, `skills` e `src/__tests__` do typecheck, e o
`next build` não lê nada disso.

**O ganho é de higiene, não de peso — medido:** tudo o que o `.dockerignore` passa a excluir soma
**1,5 MB**. O que importa é o que deixa de embarcar: o relatório de auditoria e seus logs, os
scripts internos de operação (`daemon.sh`, `kiteos-daemon.sh`, `server-watchdog.py`,
`keep-alive.sh`…), `agent-ctx/`, `examples/` e os testes. Nenhum deles tem função em produção e
todos descrevem o sistema para quem obtiver a imagem.

O volume real está em outro lugar, e este passo não o resolve:

| Componente | Tamanho |
| --- | --- |
| `.next/standalone/node_modules` (deps traçadas) | 61 MB |
| `.next/standalone/src` (fonte traçada) | 2,6 MB |
| `.next/standalone/public` | 3,5 MB |
| `.next/static` (copiado à parte para a imagem) | **2,1 MB** |
| **`/app` na imagem construída pelo CI** | **155,7 MB** |

A diferença entre a soma local (~79 MB de standalone + 2,1 MB de static) e os 155,7 MB da imagem
é o **binário do query engine do Prisma** (`libquery_engine-linux-musl-openssl-3.0.x.so.node`),
que o `prisma generate` baixa dentro do build da imagem e que **este sandbox não consegue
baixar** — o client gerado offline não carrega engine nenhum, então a medição local não o inclui.

O efeito é afirmado pelo job `docker` do CI, que **inspeciona a imagem construída**
(`test ! -e /app/audit`, `test ! -e /app/src/__tests__`) — não por medição local, já que não há
docker neste sandbox. Esse job **passou** (run `43347685341`), então a imagem construída no CI
não contém `audit/` nem `src/__tests__`, tem `server.js`, `.next/static`, `public` e `prisma`, e
roda sobre `node v22.23.5`. `src/` continua sendo traçado (2,6 MB) e `node_modules` traçado segue sendo
o grosso (~61 MB); eliminar isso exigiria trocar o build para webpack, onde
`outputFileTracingExcludes` é honrado — fora do escopo e não testado.

---

## 5. CI: quatro jobs

`.github/workflows/ci.yml` ganhou dois jobs, e o `next build` deixou de ser uma exceção
anotada para virar gate:

| Job | O que gateia |
| --- | --- |
| `quality` | `prisma generate`, `prisma validate`, typecheck, lint, 79 testes do produto, 96 de aceitação |
| `database` | shadow DB → `prisma migrate deploy` → **gate de drift** (`migrate diff --exit-code`) → 13 testes de integração em postgres:17 |
| `build` **(novo)** | grep impedindo a volta de `next/font/google`; `npm run build`; conferência da saída standalone (`server.js`, `.next/static`, `public`, `.woff2`) |
| `docker` **(novo)** | `docker build` da imagem real + inspeção do conteúdo (`server.js`, `prisma`, ausência de `audit/` e `src/__tests__`, `node --version`, `du -sh /app`) |

O grep por `next/font/google` existe porque, num runner com rede, o código antigo **passaria**
no build — o guard offline é o que impede a regressão de voltar despercebida.

### 5.1 Execução real

Run [`43347685341`](https://github.com/marcio1fs/kiteos/actions/runs/43347685341), commit
`eb3f4f9` — **os quatro jobs verdes**:

| Job | Resultado | Duração |
| --- | --- | --- |
| `Tipos, lint e testes` | success | 1m07s |
| `Migrations e concorrência (PostgreSQL 17)` | success | 1m04s |
| `Build de produção` | success | 1m11s |
| `Imagem Docker` | success | 2m12s |

No run anterior (`43347367316`) os três jobs pré-existentes e o novo job de imagem já passaram;
o job `build` falhou **no próprio guard**, que usava `grep -rn "next/font/google" src/` e casou
com o comentário de `layout.tsx` que explica por que a dependência foi removida. Corrigido para
casar apenas `from '…'` / `require('…')`, e verificado nos dois sentidos: uma sonda com
`import { Geist } from "next/font/google"` é pega, e a árvore real passa.

Evidências: `audit/evidence/ci-run-43347685341.log` (verde), `ci-run-43347367316.log` (a falha
do guard), `ci-run-43344737713.log` (passo 1).

O run seguinte (`43348061585`, commit `4668a0c`) repetiu os quatro jobs verdes e publicou como
anotação do check a medição da imagem: `node v22.23.5 | /app 155.7M`.

---

## 6. O que não foi executado aqui

1. **`docker build`** — não há docker neste sandbox. O `.dockerignore` e o `Dockerfile` foram
   validados pelo job `docker` no CI (seção 5), não localmente.
2. **`prisma generate` real** — os engines nativos vêm de `binaries.prisma.sh`, fora da allowlist.
   O build local usou o client gerado pela receita offline
   (`audit/tools/gen-prisma-types-offline.cjs`); no CI o `prisma generate` de verdade roda e
   passa. Consequência prática: **aqui o servidor standalone responde, mas não consulta o banco**
   (sem engine e sem PostgreSQL) — o 401 da seção 2 é o guard de auth, não uma query.
3. **A imagem final em produção** — o `du -sh /app` do job `docker` é a medida que vale; o
   número local (79 MB) é do build fora do contexto docker.

---

## 7. Arquivos alterados

| Arquivo | Mudança |
| --- | --- |
| `src/app/layout.tsx` | `next/font/google` → `geist/font/sans` + `geist/font/mono` (`next/font/local`) |
| `package.json` | `start` sem `bun` e sem `tee`; dependência `geist@^1.9.2` |
| `Dockerfile` | `node:20-alpine` → `node:22-alpine` (3 estágios); migrations documentadas como passo de release |
| `.dockerignore` | artefatos de dev/auditoria fora do contexto de build |
| `.github/workflows/ci.yml` | jobs `build` e `docker` |
| `src/app/api/uploads/logos/[filename]/route.ts` | só comentário: registra que `turbopackIgnore` e `outputFileTracingExcludes` foram medidos e são ignorados pelo Turbopack |

Evidências em `audit/evidence/`: `build-falha-google-fonts.log` (o defeito),
`build-offline-sucesso.log` (a correção), `standalone-smoke.log` (servidor no ar).
