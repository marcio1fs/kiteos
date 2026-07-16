/**
 * Rota de aprovação de conferência com geração automática de:
 * 1. Movimentação de estoque (ENTRADA) para cada item
 * 2. Título financeiro (PAGAR) com suporte a parcelas/duplicatas
 * 
 * Fluxo: Conferência aprovada (CONFERIDA) → Gera estoque + financeiro
 * Se divergente com aprovação manual: também gera
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { createAuditLog } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ nfeId: string }> }
) {
  try {
    const { nfeId } = await params
    const body = await request.json()
    const { officeId, userId } = body

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      )
    }

    const auth = await requireAuth(request, officeId)
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      )
    }

    // Fetch invoice with items, reception, and supplier
    const invoice = await db.invoice.findFirst({
      where: { id: nfeId, officeId, deleted: false },
      include: {
        items: { where: { deleted: false } },
        reception: true,
        supplier: true,
      },
    })

    if (!invoice) {
      return NextResponse.json(
        { success: false, error: 'NF-e não encontrada' },
        { status: 404 }
      )
    }

    if (!invoice.reception) {
      return NextResponse.json(
        { success: false, error: 'Recepção não encontrada para esta NF-e' },
        { status: 404 }
      )
    }

    // Only allow approval if reception is CONFERIDA or DIVERGENTE (with manual approval)
    if (invoice.reception.status !== 'CONFERIDA' && invoice.reception.status !== 'DIVERGENTE') {
      return NextResponse.json(
        { success: false, error: `Recepção com status "${invoice.reception.status}" não pode ser aprovada. Apenas CONFERIDA ou DIVERGENTE são aceitos.` },
        { status: 400 }
      )
    }

    // Check if already processed
    if (invoice.status === 'ESTOQUE_ATUALIZADO' || invoice.status === 'PAGA') {
      return NextResponse.json(
        { success: false, error: 'NF-e já processada. Estoque e financeiro já foram gerados.' },
        { status: 409 }
      )
    }

    // Check if financial entries already exist for this invoice
    const existingFinancial = await db.financialEntry.findFirst({
      where: {
        reference: { startsWith: `NF-${invoice.numero}` },
        category: 'NF',
        supplierId: invoice.supplierId,
        officeId,
        deleted: false,
      },
    })

    if (existingFinancial) {
      return NextResponse.json(
        { success: false, error: 'Títulos financeiros já gerados para esta NF-e' },
        { status: 409 }
      )
    }

    // Check if stock movements already exist for this invoice
    const existingMovements = await db.stockMovement.findFirst({
      where: {
        reference: `NF-${invoice.numero}`,
        officeId,
      },
    })

    if (existingMovements) {
      return NextResponse.json(
        { success: false, error: 'Movimentações de estoque já geradas para esta NF-e' },
        { status: 409 }
      )
    }

    const stockResults: Array<{
      itemId: string
      descricao: string
      partId: string | null
      quantidadeEntrada: number
      custoUnitario: number
    }> = []

    let financialEntries: Array<{
      id: string
      description: string
      amount: number
      dueDate: Date
      parcela: string
    }> = []

    // ============= STEP 1: Generate Stock Movements =============
    for (const item of invoice.items) {
      // Determine quantity received (from conference) or fallback to NF quantity
      const qtdRecebida = invoice.reception.quantidadeRecebida != null
        ? (Number(invoice.reception.quantidadeRecebida) / invoice.items.length)
        : Number(item.quantidade)

      // Skip items with 0 received quantity
      if (qtdRecebida <= 0) continue

      const custoUnitario = Number(item.valorUnitario)

      // Try to find existing part by SKU or NCM+descricao
      let part = item.partId
        ? await db.part.findFirst({ where: { id: item.partId, officeId, deleted: false } })
        : null

      if (!part) {
        // Try to match by SKU
        if (item.sku) {
          part = await db.part.findFirst({
            where: { sku: item.sku, officeId, deleted: false },
          })
        }
      }

      if (!part) {
        // Try to match by description (fuzzy)
        part = await db.part.findFirst({
          where: {
            description: { contains: item.descricao.substring(0, 30) },
            officeId,
            deleted: false,
          },
        })
      }

      // Create stock movement
      await db.stockMovement.create({
        data: {
          type: 'ENTRADA',
          quantity: qtdRecebida,
          unitCost: custoUnitario,
          reason: `Entrada via NF-e ${invoice.numero}`,
          reference: `NF-${invoice.numero}`,
          partId: part?.id || item.partId || '',
          officeId,
        },
      })

      // Update part stock quantity if part exists
      if (part) {
        await db.part.update({
          where: { id: part.id },
          data: {
            quantity: { increment: qtdRecebida },
          },
        })

        // Link item to part if not already linked
        if (!item.partId) {
          await db.invoiceItem.update({
            where: { id: item.id },
            data: { partId: part.id },
          })
        }
      }

      stockResults.push({
        itemId: item.id,
        descricao: item.descricao,
        partId: part?.id || null,
        quantidadeEntrada: qtdRecebida,
        custoUnitario,
      })
    }

    // ============= STEP 2: Generate Financial Entries =============
    const paymentTerms = invoice.supplier?.paymentTerms || 30

    // Parse XML to extract duplicatas if available
    let duplicatas: Array<{ nDup: string; dVenc: string; vDup: number }> = []
    if (invoice.xmlContent) {
      try {
        const { parseNFeXml } = await import('@/lib/nfe/xml-parser')
        const parsed = parseNFeXml(invoice.xmlContent)
        duplicatas = parsed.duplicatas || []
      } catch {
        // If XML parsing fails, fall back to single entry
      }
    }

    if (duplicatas.length > 0) {
      // Generate one financial entry per duplicata (installment)
      for (const dup of duplicatas) {
        const dueDate = dup.dVenc ? new Date(dup.dVenc) : (() => {
          const d = new Date(invoice.dataEntrada || invoice.dataEmissao)
          d.setDate(d.getDate() + paymentTerms)
          return d
        })()

        const entry = await db.financialEntry.create({
          data: {
            type: 'PAGAR',
            category: 'NF',
            description: `NF-e ${invoice.numero} - ${invoice.supplier?.razaoSocial || 'Fornecedor'} - Parcela ${dup.nDup}`,
            amount: dup.vDup,
            discount: 0,
            interest: 0,
            totalAmount: dup.vDup,
            status: 'PENDENTE',
            dueDate,
            reference: `NF-${invoice.numero}-${dup.nDup}`,
            supplierId: invoice.supplierId,
            officeId,
          },
        })

        financialEntries.push({
          id: entry.id,
          description: entry.description,
          amount: Number(entry.amount),
          dueDate: entry.dueDate,
          parcela: dup.nDup,
        })
      }
    } else {
      // No duplicatas - generate single financial entry
      const dueDate = new Date(invoice.dataEntrada || invoice.dataEmissao)
      dueDate.setDate(dueDate.getDate() + paymentTerms)

      const entry = await db.financialEntry.create({
        data: {
          type: 'PAGAR',
          category: 'NF',
          description: `NF-e ${invoice.numero} - ${invoice.supplier?.razaoSocial || 'Fornecedor'}`,
          amount: Number(invoice.totalNf),
          discount: 0,
          interest: 0,
          totalAmount: Number(invoice.totalNf),
          status: 'PENDENTE',
          dueDate,
          reference: `NF-${invoice.numero}`,
          supplierId: invoice.supplierId,
          officeId,
        },
      })

      financialEntries.push({
        id: entry.id,
        description: entry.description,
        amount: Number(entry.amount),
        dueDate: entry.dueDate,
        parcela: 'Única',
      })
    }

    // ============= STEP 3: Update Invoice Status =============
    await db.invoice.update({
      where: { id: nfeId },
      data: { status: 'ESTOQUE_ATUALIZADO' },
    })

    // ============= STEP 4: Audit Log =============
    await createAuditLog({
      action: 'SEFAZ_APROVAR_CONFERENCIA',
      entity: 'Invoice',
      entityId: nfeId,
      details: JSON.stringify({
        invoiceNumero: invoice.numero,
        stockMovements: stockResults.length,
        financialEntries: financialEntries.length,
        totalFinancialAmount: financialEntries.reduce((sum, e) => sum + e.amount, 0),
        duplicatas: duplicatas.length,
      }),
      userId: userId || auth.payload.userId,
      officeId,
      invoiceId: nfeId,
    })

    return NextResponse.json({
      success: true,
      data: {
        invoiceId: nfeId,
        status: 'ESTOQUE_ATUALIZADO',
        stock: {
          movementsCreated: stockResults.length,
          items: stockResults,
        },
        financial: {
          entriesCreated: financialEntries.length,
          totalAmount: financialEntries.reduce((sum, e) => sum + e.amount, 0),
          entries: financialEntries,
        },
      },
    })

  } catch (error) {
    console.error('Erro ao aprovar conferência:', error)
    return NextResponse.json(
      { success: false, error: 'Erro interno ao processar aprovação da conferência' },
      { status: 500 }
    )
  }
}
