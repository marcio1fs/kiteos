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
  parseCteXml,
  validateCteChave,
  validateCteXmlStructure,
  type CteClientConfig,
} from '@/lib/cte';

// Status que bloqueiam importação
const BLOCKED_STATUSES = ['CANCELADO', 'DENEGADO', 'INUTILIZADO'];

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
    const rateLimitResult = applyRateLimit(officeId, 'IMPORTACAO');
    if (rateLimitResult) {
      return NextResponse.json(
        { success: false, error: rateLimitResult.message },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rateLimitResult.retryAfterMs || 120000) / 1000)) } }
      );
    }

    // Validate chave CT-e
    if (!chave || !validateCteChave(chave)) {
      return NextResponse.json(
        { success: false, error: 'Chave de acesso CT-e inválida. Deve conter 44 dígitos numéricos, modelo 57 ou 67, com dígito verificador válido.' },
        { status: 400 }
      );
    }

    // Check if there's already a ConhecimentoTransporte with this chave
    const existingCte = await db.conhecimentoTransporte.findFirst({
      where: {
        chave,
        deleted: false,
        officeId,
      },
    });

    if (existingCte) {
      return NextResponse.json(
        { success: false, error: 'CT-e já importado neste escritório' },
        { status: 409 }
      );
    }

    // Get active certificate
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

    // Step 1: Consulta CT-e para verificar status
    const consultaResult = await consultaCte(chave, config);
    const cteStatus = consultaResult.data?.cteStatus || 'ERRO';
    const codigoStatus = consultaResult.data?.cStat || null;
    const motivoStatus = consultaResult.data?.xMotivo || null;

    // Save the consulta record
    const sefazConsulta = await db.sefazConsulta.create({
      data: {
        chave,
        ambiente: certificado.ambiente,
        protocolo: consultaResult.data?.protocolo || null,
        status: cteStatus,
        fornecedorCnpj: consultaResult.data?.emitenteCnpj || null,
        xmlArmazenado: false,
        codigoStatus,
        motivoStatus,
        tempoResposta: consultaResult.tempoResposta || null,
        tentativas: consultaResult.tentativas,
        erroMensagem: !consultaResult.success ? consultaResult.error || null : null,
        erroAmigavel: !consultaResult.success
          ? consultaResult.friendlyError || mapCteErrorToFriendly(codigoStatus || '', motivoStatus || '')
          : null,
        officeId,
        usuarioId: auth.payload.userId,
      },
    });

    // Block import if not AUTORIZADO
    if (!consultaResult.success || BLOCKED_STATUSES.includes(cteStatus)) {
      const friendlyMsg = cteStatus === 'CANCELADO'
        ? 'CT-e está cancelado e não pode ser importado'
        : cteStatus === 'DENEGADO'
          ? 'CT-e está denegado e não pode ser importado'
          : cteStatus === 'INUTILIZADO'
            ? 'CT-e está inutilizado e não pode ser importado'
            : consultaResult.friendlyError || mapCteErrorToFriendly(codigoStatus || '', motivoStatus || '');

      return NextResponse.json(
        {
          success: false,
          error: friendlyMsg,
          data: {
            status: cteStatus,
            cStat: codigoStatus,
            xMotivo: motivoStatus,
          },
        },
        { status: 422 }
      );
    }

    // Step 2: Download do XML
    const downloadResult = await downloadCte(chave, config);
    if (!downloadResult.success || !downloadResult.data?.xmlContent) {
      return NextResponse.json(
        {
          success: false,
          error: 'CT-e autorizado, mas não foi possível baixar o XML. Tente novamente.',
          data: {
            status: cteStatus,
            cStat: codigoStatus,
          },
        },
        { status: 422 }
      );
    }

    const xmlContent = downloadResult.data.xmlContent;

    // Update SefazConsulta with XML
    await db.sefazConsulta.update({
      where: { id: sefazConsulta.id },
      data: {
        xmlArmazenado: true,
        xmlContent,
      },
    });

    // Step 3: Validate XML structure
    const xmlValidation = validateCteXmlStructure(xmlContent);
    if (!xmlValidation.valid) {
      return NextResponse.json(
        { success: false, error: `XML do CT-e inválido: ${xmlValidation.errors.join(', ')}` },
        { status: 400 }
      );
    }

    // Step 4: Parse the XML
    let parsedCte;
    try {
      parsedCte = parseCteXml(xmlContent);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : 'Erro ao parsear XML do CT-e';
      return NextResponse.json(
        { success: false, error: `Erro no parse do XML: ${message}` },
        { status: 400 }
      );
    }

    // Step 5: Create or update Supplier (transportadora) by CNPJ
    let supplier = await db.supplier.findFirst({
      where: { cnpj: parsedCte.emitente.cnpj, officeId, deleted: false },
    });

    if (!supplier) {
      supplier = await db.supplier.create({
        data: {
          cnpj: parsedCte.emitente.cnpj,
          razaoSocial: parsedCte.emitente.razaoSocial,
          ie: parsedCte.emitente.ie,
          address: parsedCte.emitente.endereco.logradouro
            ? `${parsedCte.emitente.endereco.logradouro}, ${parsedCte.emitente.endereco.numero || 'S/N'}`
            : null,
          city: parsedCte.emitente.endereco.municipio,
          state: parsedCte.emitente.endereco.uf,
          zipCode: parsedCte.emitente.endereco.cep,
          phone: parsedCte.emitente.endereco.fone,
          officeId,
        },
      });
    } else {
      // Update supplier with enriched data from CT-e
      await db.supplier.update({
        where: { id: supplier.id },
        data: {
          razaoSocial: parsedCte.emitente.razaoSocial,
          ...(parsedCte.emitente.ie ? { ie: parsedCte.emitente.ie } : {}),
          ...(parsedCte.emitente.endereco.municipio ? { city: parsedCte.emitente.endereco.municipio } : {}),
          ...(parsedCte.emitente.endereco.uf ? { state: parsedCte.emitente.endereco.uf } : {}),
          ...(parsedCte.emitente.endereco.cep ? { zipCode: parsedCte.emitente.endereco.cep } : {}),
          ...(parsedCte.emitente.endereco.fone ? { phone: parsedCte.emitente.endereco.fone } : {}),
        },
      });
    }

    // Step 6: Parse date
    const dataEmissao = parsedCte.dataEmissao
      ? new Date(parsedCte.dataEmissao)
      : new Date();

    // Calculate total impostos (ICMS + ST + partilha)
    const valorImpostos = parsedCte.valorImpostos.vICMS
      + parsedCte.valorImpostos.vST
      + parsedCte.valorImpostos.vICMSUFFim
      + parsedCte.valorImpostos.vICMSUIIni;

    // Step 7: Create ConhecimentoTransporte
    const conhecimento = await db.conhecimentoTransporte.create({
      data: {
        chave: parsedCte.chave,
        numero: parsedCte.numero,
        serie: parsedCte.serie,
        dataEmissao,
        tipoCte: parsedCte.tipoCte,
        modal: parsedCte.modal,
        naturezaOperacao: parsedCte.naturezaOperacao,
        emitenteCnpj: parsedCte.emitente.cnpj,
        emitenteRazao: parsedCte.emitente.razaoSocial,
        destinatarioCnpj: parsedCte.destinatario.cnpj || parsedCte.destinatario.cpf || null,
        destinatarioRazao: parsedCte.destinatario.razaoSocial,
        valorTotal: parsedCte.valorTotal,
        valorImpostos,
        xmlContent,
        status: 'IMPORTADA',
        nfeVinculadas: parsedCte.nfeVinculadas.length > 0
          ? JSON.stringify(parsedCte.nfeVinculadas)
          : null,
        observacao: [
          parsedCte.infCpl,
          parsedCte.naturezaOperacao ? `Nat. Op.: ${parsedCte.naturezaOperacao}` : null,
          parsedCte.modal ? `Modal: ${parsedCte.modal}` : null,
          parsedCte.tipoCte ? `Tipo: ${parsedCte.tipoCte}` : null,
          parsedCte.nfeVinculadas.length > 0 ? `NF-e vinculadas: ${parsedCte.nfeVinculadas.length}` : null,
        ].filter(Boolean).join(' | ') || null,
        supplierId: supplier.id,
        officeId,
      },
    });

    // Step 8: Auto-link NF-e vinculadas
    // Verificar se as NF-e vinculadas existem no sistema e criar alertas
    const nfeVinculadas = parsedCte.nfeVinculadas;
    const linkedNfeIds: string[] = [];

    if (nfeVinculadas.length > 0) {
      for (const nfeChave of nfeVinculadas) {
        const existingInvoice = await db.invoice.findFirst({
          where: {
            chave: nfeChave,
            deleted: false,
            officeId,
          },
          select: { id: true },
        });

        if (existingInvoice) {
          linkedNfeIds.push(existingInvoice.id);
        }
      }
    }

    // Update SefazConsulta with reference
    await db.sefazConsulta.update({
      where: { id: sefazConsulta.id },
      data: {
        // We don't have invoiceId for CT-e, but the sefaz consulta tracks it
      },
    });

    // Step 9: Create audit log
    await createAuditLog({
      action: 'CTE_IMPORTAR',
      entity: 'ConhecimentoTransporte',
      entityId: conhecimento.id,
      details: JSON.stringify({
        method: 'CTE_IMPORT',
        chave: parsedCte.chave,
        numero: parsedCte.numero,
        emitenteCnpj: parsedCte.emitente.cnpj,
        emitenteRazao: parsedCte.emitente.razaoSocial,
        valorTotal: parsedCte.valorTotal,
        tipoCte: parsedCte.tipoCte,
        modal: parsedCte.modal,
        nfeVinculadas: parsedCte.nfeVinculadas,
        linkedNfeIds,
        supplierId: supplier.id,
        sefazConsultaId: sefazConsulta.id,
      }),
      userId: auth.payload.userId,
      officeId,
    });

    return NextResponse.json({
      success: true,
      data: {
        cteId: conhecimento.id,
        emitente: parsedCte.emitente.razaoSocial,
        valorTotal: parsedCte.valorTotal,
        chave: parsedCte.chave,
        numero: parsedCte.numero,
        tipoCte: parsedCte.tipoCte,
        modal: parsedCte.modal,
        nfeVinculadas: parsedCte.nfeVinculadas,
        linkedNfeIds,
      },
    }, { status: 201 });

  } catch (error) {
    console.error('Erro na importação CT-e:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao importar CT-e da SEFAZ',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
