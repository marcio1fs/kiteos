import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { requireAuth } from '@/lib/auth';

// GET /api/service-orders/[id] - Get service order with items, client, vehicle
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

    const serviceOrder = await db.serviceOrder.findFirst({
      where: { id, deleted: false },
      include: {
        client: true,
        vehicle: true,
        items: {
          where: { deleted: false },
          include: {
            mechanic: {
              select: { id: true, name: true, commissionPct: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        notifications: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!serviceOrder) {
      return NextResponse.json(
        { success: false, error: 'Ordem de serviço não encontrada' },
        { status: 404 }
      );
    }

    if (serviceOrder.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    return NextResponse.json({ success: true, data: serviceOrder });
  } catch (error) {
    logger.error('Error getting service order:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar ordem de serviço' },
      { status: 500 }
    );
  }
}

// PUT /api/service-orders/[id] - Update service order
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
      description,
      diagnosis,
      totalDiscount,
      paymentMethod,
      items,
    } = body;

    // Check if service order exists
    const existing = await db.serviceOrder.findFirst({
      where: { id, deleted: false },
      include: { items: { where: { deleted: false } } },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Ordem de serviço não encontrada' },
        { status: 404 }
      );
    }

    if (existing.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Cannot modify a PAID or CANCELLED order
    if (existing.status === 'PAGA' || existing.status === 'CANCELADA') {
      return NextResponse.json(
        { success: false, error: `Não é possível alterar uma OS com status ${existing.status}` },
        { status: 400 }
      );
    }

    const updateData: Prisma.ServiceOrderUpdateInput = {};

    if (description !== undefined) updateData.description = description;
    if (diagnosis !== undefined) updateData.diagnosis = diagnosis;
    if (paymentMethod !== undefined) updateData.paymentMethod = paymentMethod;
    if (totalDiscount !== undefined) updateData.totalDiscount = totalDiscount;

    // If items are provided, recalculate totals and update items
    if (items && Array.isArray(items)) {
      // Validate PECA items
      for (const item of items) {
        if (item.type === 'PECA' && item.partId) {
          const part = await db.part.findFirst({
            where: { id: item.partId, officeId: existing.officeId, deleted: false },
          });
          if (!part) {
            return NextResponse.json(
              { success: false, error: `Peça não encontrada: ${item.partId}` },
              { status: 404 }
            );
          }
          // Check stock for new items (not existing ones with same or lower quantity)
          const existingItem = existing.items.find((ei) => ei.id === item.id);
          const additionalQty = existingItem
            ? Math.max(0, Number(item.quantity) - Number(existingItem.quantity))
            : Number(item.quantity);
          if (additionalQty > 0 && Number(part.quantity) < additionalQty) {
            return NextResponse.json(
              {
                success: false,
                error: `Estoque insuficiente para "${part.description}". Disponível: ${part.quantity}, Adicional: ${additionalQty}`,
              },
              { status: 400 }
            );
          }
        }
      }

      // Separate items into create, update, delete
      const itemIdsToKeep = items.filter((i: { id?: string }) => i.id).map((i: { id: string }) => i.id);
      const itemsToCreate = items.filter((i: { id?: string }) => !i.id);
      const itemsToUpdate = items.filter((i: { id?: string }) => i.id);
      const itemsToDelete = existing.items.filter((ei) => !itemIdsToKeep.includes(ei.id));

      // Calculate new totals
      let totalParts = 0;
      let totalServices = 0;

      const processedNewItems = itemsToCreate.map((item: {
        type: string;
        description: string;
        quantity: number;
        unitPrice: number;
        partId?: string;
        mechanicId?: string;
        commissionPct?: number;
      }) => {
        const totalPrice = item.quantity * item.unitPrice;
        if (item.type === 'PECA') {
          totalParts += totalPrice;
        } else {
          totalServices += totalPrice;
        }
        const commPct = item.type === 'SERVICO' && item.mechanicId ? (item.commissionPct ?? 0) : 0;
        const commValue = totalPrice * (commPct / 100);
        return {
          type: item.type,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice,
          partId: item.partId || null,
          mechanicId: item.mechanicId || null,
          commissionPct: commPct,
          commissionValue: commValue,
        };
      });

      // Process updated items
      for (const item of itemsToUpdate) {
        const totalPrice = item.quantity * item.unitPrice;
        if (item.type === 'PECA') {
          totalParts += totalPrice;
        } else {
          totalServices += totalPrice;
        }
      }

      // Subtract deleted items from totals
      for (const deletedItem of itemsToDelete) {
        // These will be subtracted since we're recalculating from the provided items
      }

      const discount = totalDiscount !== undefined ? totalDiscount : Number(existing.totalDiscount);
      const totalAmount = totalParts + totalServices - discount;

      updateData.totalParts = totalParts;
      updateData.totalServices = totalServices;
      updateData.totalAmount = totalAmount;
      if (totalDiscount !== undefined) updateData.totalDiscount = totalDiscount;

      // Use transaction to update items atomically (with stock adjustments)
      const result = await db.$transaction(async (tx) => {
        // === RETURN STOCK FOR DELETED PECA ITEMS ===
        for (const itemToDelete of itemsToDelete) {
          await tx.serviceOrderItem.update({
            where: { id: itemToDelete.id },
            data: { deleted: true },
          });
          // Return stock for PECA items being removed
          if (itemToDelete.type === 'PECA' && itemToDelete.partId) {
            const part = await tx.part.findFirst({
              where: { id: itemToDelete.partId, deleted: false },
            });
            if (part) {
              // Create ENTRADA stock movement (return)
              await tx.stockMovement.create({
                data: {
                  type: 'ENTRADA',
                  quantity: Number(itemToDelete.quantity),
                  unitCost: Number(part.costPrice),
                  reason: 'Estorno - Item removido da OS',
                  reference: existing.number,
                  partId: part.id,
                  officeId: existing.officeId,
                },
              });
              // Return stock quantity
              await tx.part.update({
                where: { id: part.id },
                data: { quantity: Number(part.quantity) + Number(itemToDelete.quantity) },
              });
            }
          }
        }

        // === UPDATE EXISTING ITEMS (adjust stock for PECA quantity changes) ===
        for (const item of itemsToUpdate) {
          const totalPrice = item.quantity * item.unitPrice;
          const commPct = item.type === 'SERVICO' && item.mechanicId ? (item.commissionPct ?? 0) : 0;
          const commValue = totalPrice * (commPct / 100);
          
          // Stock adjustment for PECA items
          if (item.type === 'PECA' && item.partId) {
            const existingItem = existing.items.find((ei) => ei.id === item.id);
            const oldQty = existingItem ? Number(existingItem.quantity) : 0;
            const qtyDiff = Number(item.quantity) - oldQty;
            
            if (qtyDiff !== 0 && existingItem) {
              const part = await tx.part.findFirst({
                where: { id: item.partId, deleted: false },
              });
              if (part) {
                if (qtyDiff > 0) {
                  // Need more stock - deduct additional quantity
                  if (Number(part.quantity) < qtyDiff) {
                    throw new Error(`Estoque insuficiente para "${part.description}". Disponível: ${part.quantity}, Adicional: ${qtyDiff}`);
                  }
                  await tx.stockMovement.create({
                    data: {
                      type: 'SAIDA',
                      quantity: qtyDiff,
                      unitCost: Number(part.costPrice),
                      reason: 'Ajuste - Quantidade aumentada na OS',
                      reference: existing.number,
                      partId: part.id,
                      officeId: existing.officeId,
                    },
                  });
                  await tx.part.update({
                    where: { id: part.id },
                    data: { quantity: Number(part.quantity) - qtyDiff },
                  });
                } else if (qtyDiff < 0) {
                  // Less quantity needed - return the difference
                  const returnQty = Math.abs(qtyDiff);
                  await tx.stockMovement.create({
                    data: {
                      type: 'ENTRADA',
                      quantity: returnQty,
                      unitCost: Number(part.costPrice),
                      reason: 'Estorno - Quantidade reduzida na OS',
                      reference: existing.number,
                      partId: part.id,
                      officeId: existing.officeId,
                    },
                  });
                  await tx.part.update({
                    where: { id: part.id },
                    data: { quantity: Number(part.quantity) + returnQty },
                  });
                }
              }
            }
          }
          
          await tx.serviceOrderItem.update({
            where: { id: item.id },
            data: {
              type: item.type,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              totalPrice,
              partId: item.partId || null,
              mechanicId: item.type === 'SERVICO' ? (item.mechanicId || null) : null,
              commissionPct: commPct,
              commissionValue: commValue,
            },
          });
        }

        // === CREATE NEW ITEMS AND DEDUCT STOCK FOR PECA ===
        if (processedNewItems.length > 0) {
          await tx.serviceOrderItem.createMany({
            data: processedNewItems.map((item: {
              type: string;
              description: string;
              quantity: number;
              unitPrice: number;
              totalPrice: number;
              partId: string | null;
              mechanicId: string | null;
              commissionPct: number;
              commissionValue: number;
            }) => ({
              ...item,
              serviceOrderId: id,
              officeId: existing.officeId,
            })),
          });
          
          // Deduct stock for new PECA items
          const newPecaItems = itemsToCreate.filter((item: { type: string; partId?: string }) => item.type === 'PECA' && item.partId);
          for (const item of newPecaItems) {
            const part = await tx.part.findFirst({
              where: { id: item.partId, deleted: false },
            });
            if (part) {
              await tx.stockMovement.create({
                data: {
                  type: 'SAIDA',
                  quantity: Number(item.quantity),
                  unitCost: Number(part.costPrice),
                  reason: 'Baixa - Novo item adicionado à OS',
                  reference: existing.number,
                  partId: part.id,
                  officeId: existing.officeId,
                },
              });
              await tx.part.update({
                where: { id: part.id },
                data: { quantity: Number(part.quantity) - Number(item.quantity) },
              });
            }
          }
        }

        // Update the service order
        const updated = await tx.serviceOrder.update({
          where: { id },
          data: updateData,
          include: {
            client: true,
            vehicle: true,
            items: {
              where: { deleted: false },
              include: {
                mechanic: {
                  select: { id: true, name: true, commissionPct: true },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        });

        return updated;
      });

      return NextResponse.json({ success: true, data: result });
    }

    // If only updating non-item fields (and totalDiscount changed, recalculate)
    if (totalDiscount !== undefined) {
      updateData.totalAmount = Number(existing.totalParts) + Number(existing.totalServices) - totalDiscount;
    }

    const updated = await db.serviceOrder.update({
      where: { id },
      data: updateData,
      include: {
        client: true,
        vehicle: true,
        items: {
          where: { deleted: false },
          include: {
            mechanic: {
              select: { id: true, name: true, commissionPct: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return NextResponse.json({ success: true, data: updated });
  } catch (error) {
    logger.error('Error updating service order:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar ordem de serviço' },
      { status: 500 }
    );
  }
}

// DELETE /api/service-orders/[id] - Soft delete
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

    const existing = await db.serviceOrder.findFirst({
      where: { id, deleted: false },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'Ordem de serviço não encontrada' },
        { status: 404 }
      );
    }

    if (existing.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Cannot delete a PAID order
    if (existing.status === 'PAGA') {
      return NextResponse.json(
        { success: false, error: 'Não é possível excluir uma OS já paga' },
        { status: 400 }
      );
    }

    await db.$transaction(async (tx) => {
      // === RETURN STOCK FOR PECA ITEMS BEFORE DELETING ===
      const existingItems = await tx.serviceOrderItem.findMany({
        where: { serviceOrderId: id, deleted: false },
      });
      const pecaItems = existingItems.filter((item) => item.type === 'PECA' && item.partId);
      for (const item of pecaItems) {
        const part = await tx.part.findFirst({
          where: { id: item.partId!, deleted: false },
        });
        if (part) {
          // Create ENTRADA stock movement (return)
          await tx.stockMovement.create({
            data: {
              type: 'ENTRADA',
              quantity: Number(item.quantity),
              unitCost: Number(part.costPrice),
              reason: 'Estorno - Ordem de Serviço excluída',
              reference: existing.number,
              partId: part.id,
              officeId: existing.officeId,
            },
          });
          // Return stock quantity
          await tx.part.update({
            where: { id: part.id },
            data: { quantity: Number(part.quantity) + Number(item.quantity) },
          });
        }
      }

      // Soft delete the service order
      await tx.serviceOrder.update({
        where: { id },
        data: { deleted: true, status: 'CANCELADA' },
      });

      // Soft delete items
      await tx.serviceOrderItem.updateMany({
        where: { serviceOrderId: id },
        data: { deleted: true },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          action: 'DELETE',
          entity: 'ServiceOrder',
          entityId: id,
          details: JSON.stringify({ number: existing.number, previousStatus: existing.status }),
          officeId: existing.officeId,
        },
      });
    });

    return NextResponse.json({ success: true, data: { id, deleted: true } });
  } catch (error) {
    logger.error('Error deleting service order:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao excluir ordem de serviço' },
      { status: 500 }
    );
  }
}
