/**
 * POST /api/sefaz/manifestacao
 * Envia evento de Manifestação do Destinatário para a SEFAZ
 *
 * Body: { officeId, chave, tipoEvento, justificativa? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'
import { applyRateLimit } from '@/lib/sefaz/rate-limiter'
import { validateChave } from '@/lib/nfe/xml-parser'
import {
  enviarManifestacao,
  MANIFESTACAO_EVENTOS,
  mapManifestacaoErrorToFriendly,
  type TipoManifestacao,
  type ManifestacaoResult,
} from '@/lib/sefaz/manifestacao'
import type { Ambiente } from '@/lib/sefaz/endpoints'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { officeId, chave, tipoEvento, justificativa } = body

    // Validação do officeId
    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      )
    }

    // Autenticação
    const auth = await requireAuth(request, officeId)
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      )
    }

    // Rate limiting
    const rateLimitResult = applyRateLimit(officeId, 'CONSULTA')
    if (rateLimitResult) {
      return NextResponse.json(
        {
          success: false,
          error: rateLimitResult.message,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil((rateLimitResult.retryAfterMs || 60000) / 1000)),
          },
        }
      )
    }

    // Validação da chave de acesso
    if (!chave || !validateChave(chave)) {
      return NextResponse.json(
        {
          success: false,
          error: 'Chave de acesso inválida. Deve conter 44 dígitos numéricos com dígito verificador válido.',
        },
        { status: 400 }
      )
    }

    // Validação do tipo de evento
    const tiposValidos = Object.keys(MANIFESTACAO_EVENTOS) as TipoManifestacao[]
    if (!tipoEvento || !tiposValidos.includes(tipoEvento)) {
      return NextResponse.json(
        {
          success: false,
          error: `Tipo de evento inválido. Valores aceitos: ${tiposValidos.join(', ')}`,
        },
        { status: 400 }
      )
    }

    // Justificativa obrigatória para OPERACAO_NAO_REALIZADA
    if (tipoEvento === 'OPERACAO_NAO_REALIZADA') {
      if (!justificativa || justificativa.trim().length < 15) {
        return NextResponse.json(
          {
            success: false,
            error: 'Justificativa é obrigatória para Operação não Realizada e deve ter no mínimo 15 caracteres',
          },
          { status: 400 }
        )
      }
      if (justificativa.length > 255) {
        return NextResponse.json(
          {
            success: false,
            error: 'Justificativa deve ter no máximo 255 caracteres',
          },
          { status: 400 }
        )
      }
    }

    // Verificar se já existe manifestação do mesmo tipo para esta chave
    const manifestacaoExistente = await db.manifestacaoDestinatario.findFirst({
      where: {
        chave: chave.replace(/\D/g, ''),
        tipoEvento,
        status: { in: ['REGISTRADA', 'PENDENTE'] },
        officeId,
      },
    })

    if (manifestacaoExistente) {
      return NextResponse.json(
        {
          success: false,
          error: `Já existe uma manifestação do tipo ${MANIFESTACAO_EVENTOS[tipoEvento as TipoManifestacao].descricao} para esta NF-e`,
        },
        { status: 409 }
      )
    }

    // Obter certificado digital ativo
    const certificado = await db.certificadoDigital.findFirst({
      where: {
        officeId,
        ativo: true,
        deleted: false,
      },
    })

    if (!certificado) {
      return NextResponse.json(
        { success: false, error: 'Nenhum certificado digital ativo encontrado para este escritório' },
        { status: 404 }
      )
    }

    // Verificar validade do certificado
    if (certificado.validade && new Date(certificado.validade) < new Date()) {
      return NextResponse.json(
        { success: false, error: 'Certificado digital expirado. Renove o certificado para continuar' },
        { status: 400 }
      )
    }

    // Obter CNPJ do destinatário
    const cnpjCpf = certificado.cnpjCpf || ''
    if (!cnpjCpf) {
      return NextResponse.json(
        { success: false, error: 'CNPJ/CPF não configurado no certificado digital' },
        { status: 400 }
      )
    }

    // Criar registro de manifestação como PENDENTE antes do envio
    const eventoInfo = MANIFESTACAO_EVENTOS[tipoEvento as TipoManifestacao]
    const manifestacaoRecord = await db.manifestacaoDestinatario.create({
      data: {
        chave: chave.replace(/\D/g, ''),
        tipoEvento,
        codigoEvento: eventoInfo.codigo,
        dataEvento: new Date(),
        justificativa: tipoEvento === 'OPERACAO_NAO_REALIZADA' ? justificativa.substring(0, 255) : null,
        status: 'PENDENTE',
        tentativas: 1,
        officeId,
        usuarioId: auth.payload.userId,
      },
    })

    // Enviar manifestação para SEFAZ
    const result: ManifestacaoResult = await enviarManifestacao(
      chave.replace(/\D/g, ''),
      tipoEvento as TipoManifestacao,
      {
        ambiente: certificado.ambiente as Ambiente,
        uf: certificado.uf,
        cnpjCpf,
      },
      tipoEvento === 'OPERACAO_NAO_REALIZADA' ? justificativa : undefined
    )

    // Determinar status do registro
    const isSuccessful = result.success && result.data?.cStat === '135'
    const status = isSuccessful
      ? 'REGISTRADA'
      : result.data?.cStat
        ? 'REJEITADA'
        : 'ERRO'

    // Atualizar registro com resultado
    await db.manifestacaoDestinatario.update({
      where: { id: manifestacaoRecord.id },
      data: {
        status,
        protocolo: result.data?.nProt || null,
        codigoRetorno: result.data?.cStat || null,
        motivoRetorno: result.data?.xMotivo || result.error || null,
        tentativas: result.tentativas,
        erroMensagem: !isSuccessful ? (result.error || result.friendlyError || null) : null,
        dataEvento: result.data?.dhRegEvento
          ? new Date(result.data.dhRegEvento)
          : new Date(),
      },
    })

    // Criar audit log
    await createAuditLog({
      action: 'SEFAZ_MANIFESTACAO',
      entity: 'ManifestacaoDestinatario',
      entityId: manifestacaoRecord.id,
      details: JSON.stringify({
        chave: chave.replace(/\D/g, ''),
        tipoEvento,
        codigoEvento: eventoInfo.codigo,
        descricao: eventoInfo.descricao,
        status,
        cStat: result.data?.cStat || null,
        xMotivo: result.data?.xMotivo || null,
        nProt: result.data?.nProt || null,
        tempoResposta: result.tempoResposta,
        tentativas: result.tentativas,
      }),
      userId: auth.payload.userId,
      officeId,
    })

    // Montar resposta
    const responseData: Record<string, unknown> = {
      success: isSuccessful,
      data: {
        id: manifestacaoRecord.id,
        chave: chave.replace(/\D/g, ''),
        tipoEvento,
        descricao: eventoInfo.descricao,
        codigoEvento: eventoInfo.codigo,
        status,
        protocolo: result.data?.nProt || null,
        cStat: result.data?.cStat || null,
        xMotivo: result.data?.xMotivo || null,
        dhRegEvento: result.data?.dhRegEvento || null,
        tempoResposta: result.tempoResposta,
        tentativas: result.tentativas,
      },
    }

    if (!isSuccessful) {
      responseData.error = result.error || `${result.data?.cStat} - ${result.data?.xMotivo}`
      responseData.friendlyError = result.friendlyError
        || mapManifestacaoErrorToFriendly(result.data?.cStat || '', result.data?.xMotivo || '')
    }

    return NextResponse.json(responseData, {
      status: isSuccessful ? 200 : 422,
    })
  } catch (error) {
    console.error('Erro ao enviar manifestação do destinatário:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao enviar manifestação do destinatário',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    )
  }
}
