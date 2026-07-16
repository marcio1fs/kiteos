import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// Valid status transitions: ABERTA → EM_EXECUCAO → FINALIZADA → PAGA
const VALID_TRANSITIONS: Record<string, string[]> = {
  ABERTA: ['EM_EXECUCAO', 'CANCELADA'],
  EM_EXECUCAO: ['FINALIZADA', 'CANCELADA'],
  FINALIZADA: ['PAGA', 'CANCELADA'],
  PAGA: [],
  CANCELADA: [],
};

// PUT /api/service-orders/[id]/status - Change service order status
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
    const { status: newStatus, paymentMethod } = body;

    if (!newStatus) {
      return NextResponse.json(
        { success: false, error: 'Status é obrigatório' },
        { status: 400 }
      );
    }

    const validStatuses = ['ABERTA', 'EM_EXECUCAO', 'FINALIZADA', 'PAGA', 'CANCELADA'];
    if (!validStatuses.includes(newStatus)) {
      return NextResponse.json(
        { success: false, error: `Status inválido: ${newStatus}` },
        { status: 400 }
      );
    }

    const serviceOrder = await db.serviceOrder.findFirst({
      where: { id, deleted: false },
      include: {
        client: true,
        items: {
          where: { deleted: false },
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

    const currentStatus = serviceOrder.status;

    // Check if transition is valid
    const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowedTransitions.includes(newStatus)) {
      return NextResponse.json(
        {
          success: false,
          error: `Transição de status inválida: ${currentStatus} → ${newStatus}. Transições permitidas: ${allowedTransitions.join(', ') || 'Nenhuma'}`,
        },
        { status: 400 }
      );
    }

    // Perform status change with side effects
    const result = await db.$transaction(async (tx) => {
      const updateData: Record<string, unknown> = {
        status: newStatus,
      };

      if (paymentMethod) {
        updateData.paymentMethod = paymentMethod;
      }

      // === WHEN STATUS CHANGES TO PAGA ===
      if (newStatus === 'PAGA') {
        updateData.paidAt = new Date();
        if (paymentMethod) {
          updateData.paymentMethod = paymentMethod;
        }

        // Create FinancialEntry (type: RECEBER)
        // OS-05 FIX: totalAmount should be totalAmount - totalDiscount
        const netAmount = Number(serviceOrder.totalAmount) - Number(serviceOrder.totalDiscount);
        await tx.financialEntry.create({
          data: {
            type: 'RECEBER',
            category: 'OS',
            description: `Recebimento OS ${serviceOrder.number} - ${serviceOrder.client.name}`,
            amount: Number(serviceOrder.totalAmount),
            discount: Number(serviceOrder.totalDiscount),
            totalAmount: Math.max(0, netAmount),
            status: 'PAGO',
            dueDate: new Date(),
            paymentDate: new Date(),
            paymentMethod: paymentMethod || serviceOrder.paymentMethod,
            reference: serviceOrder.number,
            officeId: serviceOrder.officeId,
          },
        });

        // NOTE: Stock deduction now happens at OS creation time, not at payment.
        // Stock was already deducted when PECA items were added to the OS.
      }

      // === WHEN STATUS CHANGES TO CANCELADA ===
      if (newStatus === 'CANCELADA') {
        // Return stock for all PECA items (reverse the stock deduction from creation)
        const pecaItems = serviceOrder.items.filter((item) => item.type === 'PECA' && item.partId);
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
                reason: 'Estorno - Ordem de Serviço cancelada',
                reference: serviceOrder.number,
                partId: part.id,
                officeId: serviceOrder.officeId,
              },
            });
            // Return stock quantity
            await tx.part.update({
              where: { id: part.id },
              data: { quantity: Number(part.quantity) + Number(item.quantity) },
            });
          }
        }
      }

      // === WHEN STATUS CHANGES TO FINALIZADA ===
      if (newStatus === 'FINALIZADA') {
        // Send notification to client
        const client = serviceOrder.client;
        if (client.phone || client.email) {
          await tx.notification.create({
            data: {
              type: client.phone ? 'WHATSAPP' : 'EMAIL',
              template: 'OS_COMPLETED',
              title: 'Ordem de Serviço Finalizada',
              message: `Sua Ordem de Serviço ${serviceOrder.number} foi finalizada e está pronta para retirada. Valor total: R$ ${Number(serviceOrder.totalAmount).toFixed(2)}`,
              recipient: client.phone || client.email,
              status: 'PENDENTE',
              serviceOrderId: id,
              officeId: serviceOrder.officeId,
            },
          });
        }
      }

      // Update the service order status
      const updated = await tx.serviceOrder.update({
        where: { id },
        data: updateData,
        include: {
          client: {
            select: { id: true, name: true, phone: true, email: true },
          },
          vehicle: {
            select: { id: true, plate: true, brand: true, model: true },
          },
          items: {
            where: { deleted: false },
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      // Create audit log
      await tx.auditLog.create({
        data: {
          action: 'STATUS_CHANGE',
          entity: 'ServiceOrder',
          entityId: id,
          details: JSON.stringify({
            number: serviceOrder.number,
            fromStatus: currentStatus,
            toStatus: newStatus,
          }),
          officeId: serviceOrder.officeId,
        },
      });

      return updated;
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error('Error changing service order status:', error);
    const message = error instanceof Error ? error.message : 'Erro ao alterar status da ordem de serviço';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
