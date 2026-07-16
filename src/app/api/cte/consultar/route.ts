import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { getUfFromChave, type Ambiente } from '@/lib/sefaz/endpoints';
import { applyRateLimit } from '@/lib/sefaz/rate-limiter';
import {
  consultaCte,
  downloadCte,
  mapCteErrorToFriendly,
  validateCteChave,
  type CteClientConfig,
} from '@/lib/cte';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { chave, officeId } = body;

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    // Rate limiting
    const rateLimitResult = applyRateLimit(officeId, 'CONSULTA');
    if (rateLimitResult) {
      return NextResponse.json(
        { success: false, error: rateLimitResult.message },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rateLimitResult.retryAfterMs || 60000) / 1000)) } }
      );
    }

    // Validate chave CT-e (including model and check digit)
    if (!chave || !validateCteChave(chave)) {
      return NextResponse.json(
        { success: false, error: 'Chave de acesso CT-e inválida. Deve conter 44 dígitos numéricos, modelo 57 ou 67, com dígito verificador válido.' },
        { status: 400 }
      );
    }

    // Get active certificate for the office
    const certificado = await db.certificadoDigital.findFirst({
      where: {
        officeId,
        ativo: true,
        deleted: false,
      },
    });

    if (!certificado) {
      return NextResponse.json(
        { success: false, error: 'Nenhum certificado digital ativo encontrado para este escritório' },
        { status: 404 }
      );
    }

    // Get UF from chave or certificate
    const uf = getUfFromChave(chave) || certificado.uf;
    if (!uf) {
      return NextResponse.json(
        { success: false, error: 'Não foi possível determinar a UF a partir da chave de acesso ou do certificado' },
        { status: 400 }
      );
    }

    // Build config from certificate
    const cnpjCpf = certificado.cnpjCpf || '';
    const config: CteClientConfig = {
      ambiente: certificado.ambiente as Ambiente,
      uf,
      cnpjCpf,
    };

    // Call consultaCte
    const consultaResult = await consultaCte(chave, config);

    // Determine status
    const status = consultaResult.success && consultaResult.data
      ? consultaResult.data.cteStatus
      : consultaResult.data?.cteStatus || 'ERRO';

    const codigoStatus = consultaResult.data?.cStat || null;
    const motivoStatus = consultaResult.data?.xMotivo || consultaResult.error || null;
    const protocolo = consultaResult.data?.protocolo || null;
    const emitenteCnpj = consultaResult.data?.emitenteCnpj || null;
    const tempoResposta = consultaResult.tempoResposta || null;
    const tentativas = consultaResult.tentativas;

    // Friendly error message
    const erroAmigavel = !consultaResult.success
      ? consultaResult.friendlyError || mapCteErrorToFriendly(codigoStatus || '', motivoStatus || '')
      : null;
    const erroMensagem = !consultaResult.success ? consultaResult.error || null : null;

    // Save SefazConsulta record (reuse existing SefazConsulta model for audit trail)
    const sefazConsulta = await db.sefazConsulta.create({
      data: {
        chave,
        ambiente: certificado.ambiente,
        protocolo,
        status,
        fornecedorCnpj: emitenteCnpj,
        xmlArmazenado: false,
        codigoStatus,
        motivoStatus,
        tempoResposta,
        tentativas,
        erroMensagem,
        erroAmigavel,
        officeId,
        usuarioId: auth.payload.userId,
      },
    });

    // If AUTORIZADO, try to download XML
    let xmlDisponivel = false;
    if (consultaResult.success && status === 'AUTORIZADO') {
      try {
        const downloadResult = await downloadCte(chave, config);
        if (downloadResult.success && downloadResult.data?.xmlContent) {
          await db.sefazConsulta.update({
            where: { id: sefazConsulta.id },
            data: {
              xmlArmazenado: true,
              xmlContent: downloadResult.data.xmlContent,
            },
          });
          xmlDisponivel = true;
        }
      } catch (downloadError) {
        console.error('Erro ao baixar XML do CT-e:', downloadError);
      }
    }

    // Create audit log
    await createAuditLog({
      action: 'CTE_CONSULTAR',
      entity: 'ConhecimentoTransporte',
      details: JSON.stringify({
        chave,
        status,
        codigoStatus,
        motivoStatus,
        xmlDisponivel,
        sefazConsultaId: sefazConsulta.id,
      }),
      userId: auth.payload.userId,
      officeId,
    });

    return NextResponse.json({
      success: true,
      data: {
        status,
        xmlDisponivel,
        protocolo,
        chave,
        cStat: codigoStatus,
        xMotivo: motivoStatus,
        tempoResposta,
      },
    });

  } catch (error) {
    console.error('Erro na consulta CT-e:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao consultar CT-e na SEFAZ',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
