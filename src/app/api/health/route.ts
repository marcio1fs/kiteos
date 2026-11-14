/**
 * GET /api/health — liveness.
 *
 * PASSO 6 (CFG-02). Responde "o processo está de pé" e nada mais: não toca em
 * banco nem em configuração, porque um healthcheck de liveness que depende de DB
 * faz o orquestrador **reiniciar** o container durante uma indisponibilidade do
 * banco, transformando queda parcial em queda total.
 *
 * Para "pode receber tráfego?" use `/api/ready`.
 *
 * Sem autenticação (está em `PUBLIC_ROUTES`) e sem rate limit: orquestradores e
 * balanceadores chamam isto de um único IP em intervalo fixo, e limitar aqui causa
 * cascata de restarts.
 */
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const startedAt = Date.now();

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
  });
}
