import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import { requireAuth } from '@/lib/auth';

// FIN-01 FIX: Added requireAuth — was completely unauthenticated
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, errors: [auth.error.message] },
        { status: auth.error.status }
      );
    }

    const body = await request.json();
    const { invoiceId, dueDate, description } = body;

    // FIN-01 FIX: Use auth.payload values instead of body
    const officeId = auth.payload.officeId;
    const userId = auth.payload.userId;

    if (!invoiceId) {
      return NextResponse.json(
        { success: false, errors: ['invoiceId é obrigatório'] },
        { status: 400 }
      );
    }

    // Fetch invoice with supplier
    const invoice = await db.invoice.findFirst({
      where: { id: invoiceId, officeId, deleted: false },
      include: { supplier: true },
    });

    if (!invoice) {
      return NextResponse.json(
        { success: false, errors: ['NF-e não encontrada'] },
        { status: 404 }
      );
    }

    // Check if financial entry already exists for this invoice
    const existingEntry = await db.financialEntry.findFirst({
      where: {
        reference: `NF-${invoice.numero}`,
        category: 'NF',
        supplierId: invoice.supplierId,
        officeId,
        deleted: false,
      },
    });

    if (existingEntry) {
      return NextResponse.json(
        { success: false, errors: ['Título financeiro já gerado para esta NF-e'] },
        { status: 409 }
      );
    }

    // Calculate due date: dataEntrada + supplier payment terms (default 30 days)
    const paymentTerms = invoice.supplier.paymentTerms || 30;
    let calculatedDueDate: Date;

    if (dueDate) {
      calculatedDueDate = new Date(dueDate);
    } else {
      const baseDate = invoice.dataEntrada || invoice.dataEmissao;
      calculatedDueDate = new Date(baseDate);
      calculatedDueDate.setDate(calculatedDueDate.getDate() + paymentTerms);
    }

    // Create FinancialEntry (type: PAGAR)
    const financialEntry = await db.financialEntry.create({
      data: {
        type: 'PAGAR',
        category: 'NF',
        description: description || `NF-e ${invoice.numero} - ${invoice.supplier.razaoSocial}`,
        amount: invoice.totalNf,
        discount: 0,
        interest: 0,
        totalAmount: invoice.totalNf,
        status: 'PENDENTE',
        dueDate: calculatedDueDate,
        reference: `NF-${invoice.numero}`,
        supplierId: invoice.supplierId,
        officeId,
      },
    });

    // Create audit log
    await createAuditLog({
      action: 'CREATE',
      entity: 'FinancialEntry',
      entityId: financialEntry.id,
      details: JSON.stringify({
        type: 'PAGAR',
        category: 'NF',
        amount: invoice.totalNf,
        dueDate: calculatedDueDate.toISOString(),
        invoiceId,
        invoiceNumero: invoice.numero,
        supplierId: invoice.supplierId,
        supplierRazaoSocial: invoice.supplier.razaoSocial,
        paymentTerms,
      }),
      userId,
      officeId,
      invoiceId,
    });

    return NextResponse.json({
      success: true,
      data: {
        id: financialEntry.id,
        type: financialEntry.type,
        category: financialEntry.category,
        description: financialEntry.description,
        amount: financialEntry.amount,
        totalAmount: financialEntry.totalAmount,
        status: financialEntry.status,
        dueDate: financialEntry.dueDate,
        reference: financialEntry.reference,
        supplierId: financialEntry.supplierId,
        paymentTerms,
      },
    }, { status: 201 });

  } catch (error) {
    console.error('Error generating financial entry:', error);
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao gerar título financeiro'] },
      { status: 500 }
    );
  }
}
