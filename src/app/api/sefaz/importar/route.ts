import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import {
  consultaProtocolo,
  downloadNfe,
  getUfFromChave,
  mapSefazErrorToFriendly,
  type SefazClientConfig,
  type Ambiente,
} from '@/lib/sefaz';
import { parseNFeXml, validateXmlStructure, validateChave } from '@/lib/nfe/xml-parser';
import { applyRateLimit } from '@/lib/sefaz/rate-limiter';

// Status that block import
const BLOCKED_STATUSES = ['CANCELADA', 'DENEGADA', 'INUTILIZADA'];

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

    // Validate chave (including check digit verification)
    if (!chave || !validateChave(chave)) {
      return NextResponse.json(
        { success: false, error: 'Chave de acesso inválida. Deve conter 44 dígitos numéricos com dígito verificador válido.' },
        { status: 400 }
      );
    }

    // Check if there's already an Invoice with this chave
    const existingInvoice = await db.invoice.findFirst({
      where: {
        chave,
        deleted: false,
        officeId,
      },
    });

    if (existingInvoice) {
      return NextResponse.json(
        { success: false, error: 'NF-e já importada neste escritório' },
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
    const config: SefazClientConfig = {
      ambiente: certificado.ambiente as Ambiente,
      uf,
      cnpjCpf,
    };

    // First, run consultaProtocolo to verify NF-e status
    const consultaResult = await consultaProtocolo(chave, config);
    const nfeStatus = consultaResult.data?.nfeStatus || 'ERRO';
    const codigoStatus = consultaResult.data?.cStat || null;
    const motivoStatus = consultaResult.data?.xMotivo || null;

    // Save the consulta record regardless of result
    const sefazConsulta = await db.sefazConsulta.create({
      data: {
        chave,
        ambiente: certificado.ambiente,
        protocolo: consultaResult.data?.protocolo || null,
        status: nfeStatus,
        fornecedorCnpj: consultaResult.data?.fornecedorCnpj || null,
        xmlArmazenado: false,
        codigoStatus,
        motivoStatus,
        tempoResposta: consultaResult.tempoResposta || null,
        tentativas: consultaResult.tentativas,
        erroMensagem: !consultaResult.success ? consultaResult.error || null : null,
        erroAmigavel: !consultaResult.success
          ? consultaResult.friendlyError || mapSefazErrorToFriendly(codigoStatus || '', motivoStatus || '')
          : null,
        officeId,
        usuarioId: auth.payload.userId,
      },
    });

    // Block import if not AUTORIZADA
    if (!consultaResult.success || BLOCKED_STATUSES.includes(nfeStatus)) {
      const friendlyMsg = nfeStatus === 'CANCELADA'
        ? 'NF-e está cancelada e não pode ser importada'
        : nfeStatus === 'DENEGADA'
          ? 'NF-e está denegada e não pode ser importada'
          : nfeStatus === 'INUTILIZADA'
            ? 'NF-e está inutilizada e não pode ser importada'
            : consultaResult.friendlyError || mapSefazErrorToFriendly(codigoStatus || '', motivoStatus || '');

      return NextResponse.json(
        {
          success: false,
          error: friendlyMsg,
          data: {
            status: nfeStatus,
            cStat: codigoStatus,
            xMotivo: motivoStatus,
          },
        },
        { status: 422 }
      );
    }

    // Download the XML
    const downloadResult = await downloadNfe(chave, config);
    if (!downloadResult.success || !downloadResult.data?.xmlContent) {
      return NextResponse.json(
        {
          success: false,
          error: 'NF-e autorizada, mas não foi possível baixar o XML. Tente novamente.',
          data: {
            status: nfeStatus,
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

    // Validate XML structure
    const xmlValidation = validateXmlStructure(xmlContent);
    if (!xmlValidation.valid) {
      return NextResponse.json(
        { success: false, error: `XML inválido: ${xmlValidation.errors.join(', ')}` },
        { status: 400 }
      );
    }

    // Parse the XML
    let parsedNFe;
    try {
      parsedNFe = parseNFeXml(xmlContent);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : 'Erro ao parsear XML';
      return NextResponse.json(
        { success: false, error: `Erro no parse do XML: ${message}` },
        { status: 400 }
      );
    }

    // Create or update Supplier by CNPJ with enriched data
    let supplier = await db.supplier.findFirst({
      where: { cnpj: parsedNFe.supplierCnpj, officeId, deleted: false },
    });

    if (!supplier) {
      supplier = await db.supplier.create({
        data: {
          cnpj: parsedNFe.supplierCnpj,
          razaoSocial: parsedNFe.supplierRazaoSocial,
          nomeFantasia: parsedNFe.emitente.nomeFantasia,
          ie: parsedNFe.emitente.ie,
          address: parsedNFe.emitente.endereco.logradouro
            ? `${parsedNFe.emitente.endereco.logradouro}, ${parsedNFe.emitente.endereco.numero || 'S/N'}`
            : null,
          city: parsedNFe.emitente.endereco.municipio,
          state: parsedNFe.emitente.endereco.uf,
          zipCode: parsedNFe.emitente.endereco.cep,
          phone: parsedNFe.emitente.endereco.fone,
          officeId,
        },
      });
    } else {
      // Update supplier with enriched data from NF-e
      await db.supplier.update({
        where: { id: supplier.id },
        data: {
          razaoSocial: parsedNFe.supplierRazaoSocial,
          ...(parsedNFe.emitente.nomeFantasia ? { nomeFantasia: parsedNFe.emitente.nomeFantasia } : {}),
          ...(parsedNFe.emitente.ie ? { ie: parsedNFe.emitente.ie } : {}),
          ...(parsedNFe.emitente.endereco.municipio ? { city: parsedNFe.emitente.endereco.municipio } : {}),
          ...(parsedNFe.emitente.endereco.uf ? { state: parsedNFe.emitente.endereco.uf } : {}),
          ...(parsedNFe.emitente.endereco.cep ? { zipCode: parsedNFe.emitente.endereco.cep } : {}),
          ...(parsedNFe.emitente.endereco.fone ? { phone: parsedNFe.emitente.endereco.fone } : {}),
        },
      });
    }

    // Calculate subtotal
    const subtotal = parsedNFe.items.reduce((sum, item) => sum + item.vProd, 0);

    // Parse date
    const dataEmissao = parsedNFe.dataEmissao
      ? new Date(parsedNFe.dataEmissao)
      : new Date();

    // Create Invoice with Items - enriched with transport and additional data
    const invoice = await db.invoice.create({
      data: {
        chave: parsedNFe.chave,
        numero: parsedNFe.numero,
        serie: parsedNFe.serie,
        tipoOperacao: 'ENTRADA',
        dataEmissao,
        dataEntrada: new Date(),
        subtotal,
        frete: parsedNFe.totals.vFrete,
        seguro: parsedNFe.totals.vSeg,
        desconto: parsedNFe.totals.vDesc,
        baseIcms: parsedNFe.totals.vBC,
        valorIcms: parsedNFe.totals.vICMS,
        valorIpi: parsedNFe.totals.vIPI,
        valorPis: parsedNFe.totals.vPIS,
        valorCofins: parsedNFe.totals.vCOFINS,
        totalNf: parsedNFe.totals.vNF,
        xmlContent,
        status: 'IMPORTADA',
        observacao: [
          parsedNFe.infCpl,
          parsedNFe.naturezaOperacao ? `Nat. Op.: ${parsedNFe.naturezaOperacao}` : null,
          parsedNFe.transporte?.transportadoraNome ? `Transp.: ${parsedNFe.transporte.transportadoraNome}` : null,
          parsedNFe.transporte?.veiculoPlaca ? `Veículo: ${parsedNFe.transporte.veiculoPlaca}/${parsedNFe.transporte.veiculoUf}` : null,
          parsedNFe.formaPagamento ? `Forma Pagto: ${parsedNFe.formaPagamento}` : null,
          parsedNFe.duplicatas.length > 0 ? `Parcelas: ${parsedNFe.duplicatas.length}` : null,
        ].filter(Boolean).join(' | ') || null,
        supplierId: supplier.id,
        officeId,
        items: {
          create: parsedNFe.items.map((item) => ({
            sku: item.cProd || null,
            descricao: item.xProd,
            ncm: item.ncm,
            cfop: item.cfop,
            cst: item.cst || null,
            csosn: item.csosn || null,
            quantidade: item.qCom,
            unidade: item.uCom,
            valorUnitario: item.vUnCom,
            valorTotal: item.vProd,
            baseIcms: item.vBC_Icms,
            valorIcms: item.vICMS,
            valorIpi: item.vIPI,
            valorPis: item.vPIS,
            valorCofins: item.vCOFINS,
            officeId,
          })),
        },
      },
      include: {
        items: true,
        supplier: true,
      },
    });

    // Create Reception with status PENDENTE
    await db.reception.create({
      data: {
        status: 'PENDENTE',
        invoiceId: invoice.id,
        officeId,
      },
    });

    // Update SefazConsulta with invoiceId
    await db.sefazConsulta.update({
      where: { id: sefazConsulta.id },
      data: { invoiceId: invoice.id },
    });

    // Create audit log
    await createAuditLog({
      action: 'SEFAZ_IMPORTAR',
      entity: 'Invoice',
      entityId: invoice.id,
      details: JSON.stringify({
        method: 'SEFAZ_IMPORT',
        chave: parsedNFe.chave,
        numero: parsedNFe.numero,
        supplierCnpj: parsedNFe.supplierCnpj,
        totalNf: parsedNFe.totals.vNF,
        itemCount: parsedNFe.items.length,
        sefazConsultaId: sefazConsulta.id,
      }),
      userId: auth.payload.userId,
      officeId,
      invoiceId: invoice.id,
    });

    return NextResponse.json({
      success: true,
      data: {
        nfeId: invoice.id,
        fornecedor: supplier.razaoSocial,
        valorTotal: parsedNFe.totals.vNF,
        chave: parsedNFe.chave,
        numero: parsedNFe.numero,
      },
    }, { status: 201 });

  } catch (error) {
    console.error('Erro na importação SEFAZ:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Erro interno ao importar NF-e da SEFAZ',
        details: error instanceof Error ? error.message : 'Erro desconhecido',
      },
      { status: 500 }
    );
  }
}
