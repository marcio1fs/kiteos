import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import {
  consultaProtocolo,
  downloadNfe,
  getUfFromChave,
  mapSefazErrorToFriendly,
  decryptPassword,
  decryptFileContent,
  type SefazClientConfig,
  type Ambiente,
} from '@/lib/sefaz';
import { validateChave } from '@/lib/nfe/xml-parser';
import { applyRateLimit } from '@/lib/sefaz/rate-limiter';

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

    // Validate chave (including check digit verification)
    if (!chave || !validateChave(chave)) {
      return NextResponse.json(
        { success: false, error: 'Chave de acesso inválida. Deve conter 44 dígitos numéricos com dígito verificador válido.' },
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

    // Decrypt certificate PFX and passphrase for mTLS
    let pfx: string | undefined;
    let passphrase: string | undefined;
    try {
      if (certificado.arquivoContent && certificado.senhaCriptografada) {
        pfx = decryptFileContent(certificado.arquivoContent);
        passphrase = decryptPassword(certificado.senhaCriptografada);
      }
    } catch (certDecError) {
      console.error('Erro ao descriptografar certificado:', certDecError);
    }

    // Build config from certificate
    const cnpjCpf = certificado.cnpjCpf || '';
    const config: SefazClientConfig = {
      ambiente: certificado.ambiente as Ambiente,
      uf,
      cnpjCpf,
      pfx,
      passphrase,
    };

    // Call consultaProtocolo
    const consultaResult = await consultaProtocolo(chave, config);

    // Determine status
    const status = consultaResult.success && consultaResult.data
      ? consultaResult.data.nfeStatus
      : consultaResult.data?.nfeStatus || 'ERRO';

    const codigoStatus = consultaResult.data?.cStat || null;
    const motivoStatus = consultaResult.data?.xMotivo || consultaResult.error || null;
    const protocolo = consultaResult.data?.protocolo || null;
    const fornecedorCnpj = consultaResult.data?.fornecedorCnpj || null;
    const tempoResposta = consultaResult.tempoResposta || null;
    const tentativas = consultaResult.tentativas;

    // Friendly error message
    const erroAmigavel = !consultaResult.success
      ? consultaResult.friendlyError || mapSefazErrorToFriendly(codigoStatus || '', motivoStatus || '')
      : null;
    const erroMensagem = !consultaResult.success ? consultaResult.error || null : null;

    // Save SefazConsulta record
    const sefazConsulta = await db.sefazConsulta.create({
      data: {
        chave,
        ambiente: certificado.ambiente,
        protocolo,
        status,
        fornecedorCnpj,
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

    // If AUTORIZADA, try to download XML
    let xmlDisponivel = false;
    if (consultaResult.success && status === 'AUTORIZADA') {
      try {
        const downloadResult = await downloadNfe(chave, config);
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
        // Download failed - consulta still succeeds, just without XML
        console.error('Erro ao baixar XML da NF-e:', downloadError);
      }
    }

    // Create audit log
    await createAuditLog({
      action: 'SEFAZ_CONSULTAR',
      entity: 'SefazConsulta',
      entityId: sefazConsulta.id,
      details: JSON.stringify({
        chave,
        status,
        codigoStatus,
        motivoStatus,
        xmlDisponivel,
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
    console.error('Erro na consulta SEFAZ:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao consultar NF-e na SEFAZ',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
