import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { requireAuth } from '@/lib/auth';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, errors: [auth.error.message] },
        { status: auth.error.status }
      );
    }
    const { officeId, userId } = auth.payload;

    // Fetch invoice with items
    const invoice = await db.invoice.findFirst({
      where: { id, officeId, deleted: false },
      include: {
        items: { where: { deleted: false } },
        supplier: true,
      },
    });

    if (!invoice) {
      return NextResponse.json(
        { success: false, errors: ['NF-e não encontrada'] },
        { status: 404 }
      );
    }

    const validationErrors: string[] = [];
    const validationWarnings: string[] = [];

    // 1. Verify subtotal: sum(item.valorTotal) = subtotal
    const itemsTotal = invoice.items.reduce((sum, item) => sum + Number(item.valorTotal), 0);
    const subtotalTolerance = 0.02;

    if (Math.abs(itemsTotal - Number(invoice.subtotal)) > subtotalTolerance) {
      validationErrors.push(
        `Subtotal divergente: soma dos itens (${itemsTotal.toFixed(2)}) não confere com subtotal da NF-e (${Number(invoice.subtotal).toFixed(2)})`
      );
    }

    // 2. Verify total NF: subtotal + frete + seguro - desconto + IPI = totalNf
    // Note: PIS and COFINS are informational taxes, NOT part of the NF total per SEFAZ rules
    const expectedTotalNf = Number(invoice.subtotal) + Number(invoice.frete) + Number(invoice.seguro) - Number(invoice.desconto) + Number(invoice.valorIpi);
    if (Math.abs(expectedTotalNf - Number(invoice.totalNf)) > subtotalTolerance) {
      validationErrors.push(
        `Total NF divergente: subtotal (${Number(invoice.subtotal).toFixed(2)}) + frete (${Number(invoice.frete).toFixed(2)}) + seguro (${Number(invoice.seguro).toFixed(2)}) - desconto (${Number(invoice.desconto).toFixed(2)}) + IPI (${Number(invoice.valorIpi).toFixed(2)}) = ${expectedTotalNf.toFixed(2)}, mas NF-e tem total ${Number(invoice.totalNf).toFixed(2)}`
      );
    }

    // 3. Verify item-level taxes using TaxRule
    let totalCalculatedIcms = 0;
    let totalCalculatedIpi = 0;
    let totalCalculatedPis = 0;
    let totalCalculatedCofins = 0;

    for (const item of invoice.items) {
      // Check for SKU mapping
      if (item.sku) {
        const part = await db.part.findFirst({
          where: { sku: item.sku, officeId, deleted: false },
        });
        if (!part) {
          validationWarnings.push(
            `Item "${item.descricao}" (SKU: ${item.sku}): sem mapeamento para peça no estoque`
          );
        }
      } else {
        validationWarnings.push(
          `Item "${item.descricao}": sem SKU definido, não será possível mapear para o estoque`
        );
      }

      // Validate CFOP
      if (!item.cfop || item.cfop.trim() === '') {
        validationErrors.push(
          `Item "${item.descricao}": CFOP não informado`
        );
      }

      // Validate NCM
      if (!item.ncm || item.ncm.trim() === '') {
        validationWarnings.push(
          `Item "${item.descricao}": NCM não informado`
        );
      }

      // Look up tax rule
      if (item.ncm && item.cfop) {
        // NFE-02 FIX: Add officeId filter to tax rule lookup
        const taxRule = await db.taxRule.findFirst({
          where: {
            ncm: item.ncm,
            cfop: item.cfop,
            active: true,
            officeId,
          },
        });

        if (taxRule) {
          // Calculate taxes based on rule
          const calcIcms = Number(item.baseIcms) * (Number(taxRule.aliqIcms) / 100);
          const calcIpi = Number(item.valorTotal) * (Number(taxRule.aliqIpi) / 100);
          const calcPis = Number(item.valorTotal) * (Number(taxRule.aliqPis) / 100);
          const calcCofins = Number(item.valorTotal) * (Number(taxRule.aliqCofins) / 100);

          totalCalculatedIcms += calcIcms;
          totalCalculatedIpi += calcIpi;
          totalCalculatedPis += calcPis;
          totalCalculatedCofins += calcCofins;

          // Compare with item values
          const itemTaxTolerance = 0.02;
          if (Math.abs(calcIcms - Number(item.valorIcms)) > itemTaxTolerance) {
            validationWarnings.push(
              `Item "${item.descricao}": ICMS calculado (${calcIcms.toFixed(2)}) diverge do valor na NF (${Number(item.valorIcms).toFixed(2)}) - Alíquota: ${taxRule.aliqIcms}%`
            );
          }
          if (Math.abs(calcIpi - Number(item.valorIpi)) > itemTaxTolerance) {
            validationWarnings.push(
              `Item "${item.descricao}": IPI calculado (${calcIpi.toFixed(2)}) diverge do valor na NF (${Number(item.valorIpi).toFixed(2)}) - Alíquota: ${taxRule.aliqIpi}%`
            );
          }
          if (Math.abs(calcPis - Number(item.valorPis)) > itemTaxTolerance) {
            validationWarnings.push(
              `Item "${item.descricao}": PIS calculado (${calcPis.toFixed(2)}) diverge do valor na NF (${Number(item.valorPis).toFixed(2)}) - Alíquota: ${taxRule.aliqPis}%`
            );
          }
          if (Math.abs(calcCofins - Number(item.valorCofins)) > itemTaxTolerance) {
            validationWarnings.push(
              `Item "${item.descricao}": COFINS calculado (${calcCofins.toFixed(2)}) diverge do valor na NF (${Number(item.valorCofins).toFixed(2)}) - Alíquota: ${taxRule.aliqCofins}%`
            );
          }
        } else {
          validationWarnings.push(
            `Item "${item.descricao}" (NCM: ${item.ncm}, CFOP: ${item.cfop}): regra fiscal não encontrada, impossível verificar impostos`
          );
        }
      }

      // Validate quantity > 0
      if (Number(item.quantidade) <= 0) {
        validationErrors.push(
          `Item "${item.descricao}": quantidade deve ser maior que zero`
        );
      }

      // Validate valorTotal = quantidade * valorUnitario
      const expectedItemTotal = Number(item.quantidade) * Number(item.valorUnitario);
      if (Math.abs(expectedItemTotal - Number(item.valorTotal)) > 0.02) {
        validationErrors.push(
          `Item "${item.descricao}": valor total (${Number(item.valorTotal).toFixed(2)}) não confere com qtd (${Number(item.quantidade)}) x valor unitário (${Number(item.valorUnitario).toFixed(2)}) = ${expectedItemTotal.toFixed(2)}`
        );
      }
    }

    // 4. Verify total ICMS
    const itemsIcmsTotal = invoice.items.reduce((sum, item) => sum + Number(item.valorIcms), 0);
    if (Math.abs(itemsIcmsTotal - Number(invoice.valorIcms)) > 0.02) {
      validationErrors.push(
        `Total ICMS dos itens (${itemsIcmsTotal.toFixed(2)}) diverge do total da NF-e (${Number(invoice.valorIcms).toFixed(2)})`
      );
    }

    // 5. Verify total IPI
    const itemsIpiTotal = invoice.items.reduce((sum, item) => sum + Number(item.valorIpi), 0);
    if (Math.abs(itemsIpiTotal - Number(invoice.valorIpi)) > 0.02) {
      validationErrors.push(
        `Total IPI dos itens (${itemsIpiTotal.toFixed(2)}) diverge do total da NF-e (${Number(invoice.valorIpi).toFixed(2)})`
      );
    }

    // Create audit log for validation
    await createAuditLog({
      action: 'VALIDATE',
      entity: 'Invoice',
      entityId: id,
      details: JSON.stringify({
        errorsCount: validationErrors.length,
        warningsCount: validationWarnings.length,
        errors: validationErrors,
        warnings: validationWarnings,
      }),
      officeId,
      userId,
      invoiceId: id,
    });

    return NextResponse.json({
      success: true,
      data: {
        invoiceId: id,
        numero: invoice.numero,
        chave: invoice.chave,
        valid: validationErrors.length === 0,
        errors: validationErrors,
        warnings: validationWarnings,
        summary: {
          totalErrors: validationErrors.length,
          totalWarnings: validationWarnings.length,
          itemsChecked: invoice.items.length,
          itemsWithoutSku: invoice.items.filter(i => !i.sku).length,
        },
      },
    });

  } catch (error) {
    logger.error('Error validating NF-e:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao validar NF-e'] },
      { status: 500 }
    );
  }
}
