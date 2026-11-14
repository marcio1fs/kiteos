# Stage 1: Dependencies
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# Stage 3: Runner
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

# PASSO 6 (CFG-02): o healthcheck antigo fazia spider em "/", que responde 200
# mesmo com DATABASE_URL quebrado, migrations não aplicadas ou JWT_SECRET ausente —
# o container era declarado saudável e recebia tráfego quebrado.
#
# /api/ready verifica configuração + banco (inclusive se as migrations foram
# aplicadas) e devolve 503 quando a instância não pode servir. /api/health continua
# existindo como liveness pura (processo de pé, sem dependências): em Kubernetes,
# use livenessProbe=/api/health e readinessProbe=/api/ready, para uma queda do
# banco marcar a instância como não-pronta em vez de reiniciá-la em loop.
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/ready || exit 1

# Migrations are a release step, not a container start step: run
#   npx prisma migrate deploy
# against the target database before rolling the new image out (the runner
# stage carries only the traced standalone output, not the Prisma CLI).
CMD ["node", "server.js"]
