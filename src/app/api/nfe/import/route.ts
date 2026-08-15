import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { parseNFeXml, validateXmlStructure, validateChave, validateCnpj } from '@/lib/nfe/xml-parser';
import { createAuditLog } from '@/lib/audit';
import { requireAuth } from '@/lib/auth';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const xmlFile = formData.get('xml') as File | null;
    const officeId = formData.get('officeId') as string | null;
    // SECURITY FIX: Removed userId from body — use authenticated user ID instead
    // Was allowing any userId to be passed, enabling impersonation

    if (!xmlFile) {
      return NextResponse.json(
        { success: false, errors: ['Arquivo XML não fornecido'] },
        { status: 400 }
      );
    }

    if (!officeId) {
      return NextResponse.json(
        { success: false, errors: ['officeId é obrigatório'] },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }
    const authenticatedUserId = auth.payload.userId;

    // ============================================================================
    // SECURITY FIX: Validate XML file size (max 2MB) to prevent memory exhaustion
    // ============================================================================
    if (xmlFile.size > 2 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, errors: ['Arquivo XML excede o tamanho máximo permitido (2MB)'] },
        { status: 400 }
      );
    }

    // Read XML content
    const xmlContent = await xmlFile.text();

    // ============================================================================
    // SECURITY FIX: Basic XML bomb protection — reject if XML contains
    // excessive entity expansions or is suspiciously large after reading
    // ============================================================================
    if (xmlContent.length > 5 * 1024 * 1024) { // 5MB max in memory
      return NextResponse.json(
        { success: false, errors: ['Conteúdo XML excede o limite de tamanho'] },
        { status: 400 }
      );
    }
    // Reject XML with entity expansion patterns (XXE/XML bomb)
    if (xmlContent.includes('<!ENTITY') || xmlContent.includes('<!DOCTYPE')) {
      return NextResponse.json(
        { success: false, errors: ['XML contém definições de entidade não permitidas (possível XXE/XML bomb)'] },
        { status: 400 }
      );
    }

    // Validate XML structure
    const xmlValidation = validateXmlStructure(xmlContent);
    if (!xmlValidation.valid) {
      return NextResponse.json(
        { success: false, errors: xmlValidation.errors },
        { status: 400 }
      );
    }

    // Parse XML
    let parsedNFe;
    try {
      parsedNFe = parseNFeXml(xmlContent);
    } catch (parseError) {
      const message = parseError instanceof Error ? parseError.message : 'Erro ao parsear XML';
      return NextResponse.json(
        { success: false, errors: [`Erro no parse do XML: ${message}`] },
        { status: 400 }
      );
    }

    const warnings: string[] = [];
    const errors: string[] = [];

    // Validate chave
    if (!validateChave(parsedNFe.chave)) {
      errors.push(`Chave de acesso inválida: ${parsedNFe.chave} (deve ter 44 dígitos)`);
    }

    // Validate supplier CNPJ
    if (!validateCnpj(parsedNFe.supplierCnpj)) {
      errors.push(`CNPJ do fornecedor inválido: ${parsedNFe.supplierCnpj}`);
    }

    // Validate items
    if (parsedNFe.items.length === 0) {
      errors.push('NF-e não contém itens');
    }

    if (errors.length > 0) {
      return NextResponse.json(
        { success: false, errors },
        { status: 400 }
      );
    }

    // Check for duplicate chave + supplier
    const existingInvoice = await db.invoice.findFirst({
      where: {
        chave: parsedNFe.chave,
        supplier: { cnpj: parsedNFe.supplierCnpj, officeId },
        deleted: false,
      },
    });

    if (existingInvoice) {
      return NextResponse.json(
        { success: false, errors: ['NF-e já importada para este fornecedor neste escritório'] },
        { status: 409 }
      );
    }

    // Create or find Supplier by CNPJ
    let supplier = await db.supplier.findFirst({
      where: { cnpj: parsedNFe.supplierCnpj, officeId, deleted: false },
    });

    if (!supplier) {
      supplier = await db.supplier.create({
        data: {
          cnpj: parsedNFe.supplierCnpj,
          razaoSocial: parsedNFe.supplierRazaoSocial,
          officeId,
        },
      });
    } else if (supplier.razaoSocial !== parsedNFe.supplierRazaoSocial) {
      // Update razaoSocial if different
      await db.supplier.update({
        where: { id: supplier.id },
        data: { razaoSocial: parsedNFe.supplierRazaoSocial },
      });
    }

    // Calculate item subtotal
    const subtotal = parsedNFe.items.reduce((sum, item) => sum + item.vProd, 0);

    // Look up tax rules for each item and validate
    // ============================================================================
    // SECURITY FIX: Scope tax rule lookup by officeId
    // Was querying ALL offices' tax rules, leaking cross-tenant data
    // ============================================================================
    const itemTaxWarnings: string[] = [];
    for (const item of parsedNFe.items) {
      if (item.ncm && item.cfop) {
        const taxRule = await db.taxRule.findFirst({
          where: {
            ncm: item.ncm,
            cfop: item.cfop,
            officeId, // SECURITY FIX: Added officeId filter
            active: true,
          },
        });

        if (!taxRule) {
          itemTaxWarnings.push(
            `Item "${item.xProd}" (NCM: ${item.ncm}, CFOP: ${item.cfop}): regra fiscal não encontrada, usando valores do XML`
          );
        }
      }
    }
    warnings.push(...itemTaxWarnings);

    // Verify totals
    const calculatedTotal = subtotal + parsedNFe.vFrete + parsedNFe.totals.vIPI + parsedNFe.totals.vPIS + parsedNFe.totals.vCOFINS;
    const tolerance = 0.02; // 2 centavos de tolerância
    if (Math.abs(calculatedTotal - parsedNFe.totals.vNF) > tolerance) {
      warnings.push(
        `Divergência nos totais: calculado=${calculatedTotal.toFixed(2)}, XML=${parsedNFe.totals.vNF.toFixed(2)}`
      );
    }

    // Parse date
    const dataEmissao = parsedNFe.dataEmissao
      ? new Date(parsedNFe.dataEmissao)
      : new Date();

    // Create Invoice with Items
    const invoice = await db.invoice.create({
      data: {
        chave: parsedNFe.chave,
        numero: parsedNFe.numero,
        serie: parsedNFe.serie,
        tipoOperacao: 'ENTRADA',
        dataEmissao,
        dataEntrada: new Date(),
        subtotal,
        frete: parsedNFe.vFrete,
        seguro: 0,
        desconto: 0,
        baseIcms: parsedNFe.totals.vBC,
        valorIcms: parsedNFe.totals.vICMS,
        valorIpi: parsedNFe.totals.vIPI,
        valorPis: parsedNFe.totals.vPIS,
        valorCofins: parsedNFe.totals.vCOFINS,
        totalNf: parsedNFe.totals.vNF,
        xmlContent,
        status: 'IMPORTADA',
        observacao: parsedNFe.infCpl || null,
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

    // Create Reception (status: PENDENTE)
    await db.reception.create({
      data: {
        status: 'PENDENTE',
        invoiceId: invoice.id,
        officeId,
      },
    });

    // Create audit log
    await createAuditLog({
      action: 'CREATE',
      entity: 'Invoice',
      entityId: invoice.id,
      details: JSON.stringify({
        method: 'IMPORT_XML',
        chave: parsedNFe.chave,
        numero: parsedNFe.numero,
        supplierCnpj: parsedNFe.supplierCnpj,
        totalNf: parsedNFe.totals.vNF,
        itemCount: parsedNFe.items.length,
      }),
      userId: authenticatedUserId, // SECURITY FIX: Use auth token, not body
      officeId,
      invoiceId: invoice.id,
    });

    return NextResponse.json({
      success: true,
      data: invoice,
      warnings: warnings.length > 0 ? warnings : undefined,
    }, { status: 201 });

  } catch (error) {
    logger.error('Error importing NF-e:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      {
        success: false,
        errors: ['Erro interno ao importar NF-e', error instanceof Error ? error.message : 'Erro desconhecido'],
      },
      { status: 500 }
    );
  }
}
