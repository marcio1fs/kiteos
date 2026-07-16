import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// GET /api/parts/[id] - Get part by id with stock movements
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { id } = await params;

    const part = await db.part.findFirst({
      where: { id, deleted: false },
      include: {
        supplier: {
          select: { id: true, razaoSocial: true, nomeFantasia: true, phone: true, email: true },
        },
        stockMovements: {
          where: { deleted: false },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });

    if (!part) {
      return NextResponse.json(
        { success: false, error: 'Peça não encontrada' },
        { status: 404 }
      );
    }

    if (part.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    return NextResponse.json({ success: true, data: part });
  } catch (error) {
    console.error('Error getting part:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar peça' },
      { status: 500 }
    );
  }
}

// PUT /api/parts/[id] - Update part
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { id } = await params;
    const body = await request.json();
    const {
      sku,
      description,
      ncm,
      cfop,
      unit,
      minQuantity,
      costPrice,
      salePrice,
      location,
      batch,
      validity,
      cst,
      csosn,
      supplierId,
    } = body;

    const existing = await db.part.findFirst({
      where: { id, deleted: false },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Peça não encontrada' },
        { status: 404 }
      );
    }

    if (existing.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // If SKU is being changed, validate uniqueness
    if (sku && sku !== existing.sku) {
      const skuConflict = await db.part.findFirst({
        where: {
          sku,
          officeId: existing.officeId,
          deleted: false,
          id: { not: id },
        },
      });
      if (skuConflict) {
        return NextResponse.json(
          { success: false, error: `SKU "${sku}" já existe nesta oficina` },
          { status: 409 }
        );
      }
    }

    // Validate supplier if provided
    if (supplierId) {
      const supplier = await db.supplier.findFirst({
        where: { id: supplierId, officeId: existing.officeId, deleted: false },
      });
      if (!supplier) {
        return NextResponse.json(
          { success: false, error: 'Fornecedor não encontrado' },
          { status: 404 }
        );
      }
    }

    // NOTE: quantity should NOT be updated directly via this endpoint.
    // Use stock-movements API to adjust quantity.
    const updateData: Record<string, unknown> = {};
    if (sku !== undefined) updateData.sku = sku;
    if (description !== undefined) updateData.description = description;
    if (ncm !== undefined) updateData.ncm = ncm || null;
    if (cfop !== undefined) updateData.cfop = cfop || null;
    if (unit !== undefined) updateData.unit = unit;
    if (minQuantity !== undefined) updateData.minQuantity = minQuantity;
    if (costPrice !== undefined) updateData.costPrice = costPrice;
    if (salePrice !== undefined) updateData.salePrice = salePrice;
    if (location !== undefined) updateData.location = location || null;
    if (batch !== undefined) updateData.batch = batch || null;
    if (validity !== undefined) updateData.validity = validity ? new Date(validity) : null;
    if (cst !== undefined) updateData.cst = cst || null;
    if (csosn !== undefined) updateData.csosn = csosn || null;
    if (supplierId !== undefined) updateData.supplierId = supplierId || null;

    const updated = await db.part.update({
      where: { id },
      data: updateData,
      include: {
        supplier: {
          select: { id: true, razaoSocial: true, nomeFantasia: true },
        },
      },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        action: 'UPDATE',
        entity: 'Part',
        entityId: id,
        details: JSON.stringify({
          sku: existing.sku,
          updatedFields: Object.keys(updateData),
        }),
        officeId: existing.officeId,
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    console.error('Error updating part:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar peça' },
      { status: 500 }
    );
  }
}

// DELETE /api/parts/[id] - Soft delete
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { id } = await params;

    const existing = await db.part.findFirst({
      where: { id, deleted: false },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Peça não encontrada' },
        { status: 404 }
      );
    }

    if (existing.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Check if part is being used in any active service order
    const activeUsage = await db.serviceOrderItem.findFirst({
      where: {
        partId: id,
        deleted: false,
        serviceOrder: {
          status: { in: ['ABERTA', 'EM_EXECUCAO'] },
          deleted: false,
        },
      },
    });

    if (activeUsage) {
      return NextResponse.json(
        { success: false, error: 'Não é possível excluir peça que está em uso em ordens de serviço ativas' },
        { status: 400 }
      );
    }

    await db.$transaction(async (tx) => {
      await tx.part.update({
        where: { id },
        data: { deleted: true },
      });

      // Soft delete stock movements
      await tx.stockMovement.updateMany({
        where: { partId: id },
        data: { deleted: true },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          action: 'DELETE',
          entity: 'Part',
          entityId: id,
          details: JSON.stringify({ sku: existing.sku, description: existing.description }),
          officeId: existing.officeId,
        },
      });
    });

    return NextResponse.json({ success: true, data: { id, deleted: true } });
  } catch (error) {
    console.error('Error deleting part:', error);
    return NextResponse.json(
      { success: false, error: 'Erro ao excluir peça' },
      { status: 500 }
    );
  }
}
