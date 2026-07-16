import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// GET /api/stock-alerts - Get low stock alerts for an office
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    // Fetch all non-deleted parts for the office
    const allParts = await db.part.findMany({
      where: {
        officeId,
        deleted: false,
      },
      include: {
        supplier: {
          select: {
            id: true,
            razaoSocial: true,
            nomeFantasia: true,
            phone: true,
            email: true,
          },
        },
      },
      orderBy: { description: 'asc' },
    });

    // Filter parts where quantity <= minQuantity
    const lowStockParts = allParts.filter(
      (part) => parseFloat(String(part.quantity)) <= parseFloat(String(part.minQuantity))
    );

    // Format the alerts with additional context
    const alerts = lowStockParts.map((part) => ({
      id: part.id,
      sku: part.sku,
      description: part.description,
      currentQuantity: parseFloat(String(part.quantity)),
      minQuantity: parseFloat(String(part.minQuantity)),
      deficit: parseFloat(String(part.minQuantity)) - parseFloat(String(part.quantity)),
      unit: part.unit,
      costPrice: parseFloat(String(part.costPrice)),
      salePrice: parseFloat(String(part.salePrice)),
      location: part.location,
      supplier: part.supplier
        ? {
            id: part.supplier.id,
            name: part.supplier.nomeFantasia || part.supplier.razaoSocial,
            phone: part.supplier.phone,
            email: part.supplier.email,
          }
        : null,
      severity: parseFloat(String(part.quantity)) === 0 ? 'CRITICAL' : 'WARNING',
    }));

    // Sort by severity (CRITICAL first), then by deficit (largest first)
    alerts.sort((a, b) => {
      if (a.severity === 'CRITICAL' && b.severity !== 'CRITICAL') return -1;
      if (a.severity !== 'CRITICAL' && b.severity === 'CRITICAL') return 1;
      return b.deficit - a.deficit;
    });

    return NextResponse.json({
      success: true,
      data: {
        total: alerts.length,
        critical: alerts.filter((a) => a.severity === 'CRITICAL').length,
        warning: alerts.filter((a) => a.severity === 'WARNING').length,
        alerts,
      },
    });
  } catch (error) {
    console.error('Error getting stock alerts:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar alertas de estoque' },
      { status: 500 }
    );
  }
}
