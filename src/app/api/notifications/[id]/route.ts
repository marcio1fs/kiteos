import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// AUD-C04 FIX: Added requireAuth — was completely unauthenticated
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }

    const { id } = await params;
    const officeId = auth.payload.officeId;

    const notification = await db.notification.findFirst({
      where: { id, officeId }, // QRY-04: Notification model has no 'deleted' field
      include: {
        serviceOrder: {
          select: {
            id: true,
            number: true,
            status: true,
            description: true,
          },
        },
      },
    });

    if (!notification) {
      return NextResponse.json(
        { success: false, errors: ['Notificação não encontrada'] },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: notification,
    });

  } catch (error) {
    logger.error('Error fetching notification:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao buscar notificação'] },
      { status: 500 }
    );
  }
}

// AUD-C04 FIX: Added requireAuth — was completely unauthenticated
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }

    const { id } = await params;
    const body = await request.json();
    const { status, sentAt, ...otherFields } = body;
    const officeId = auth.payload.officeId;

    const existing = await db.notification.findFirst({
      where: { id, officeId }, // QRY-04: Notification model has no 'deleted' field
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, errors: ['Notificação não encontrada'] },
        { status: 404 }
      );
    }

    // Build update data
    const dataToUpdate: Record<string, unknown> = {};

    if (status) {
      if (!['PENDENTE', 'ENVIADA', 'FALHOU'].includes(status)) {
        return NextResponse.json(
          { success: false, errors: ['status deve ser PENDENTE, ENVIADA ou FALHOU'] },
          { status: 400 }
        );
      }
      dataToUpdate.status = status;

      // If marking as sent, set sentAt
      if (status === 'ENVIADA' && !sentAt) {
        dataToUpdate.sentAt = new Date();
      }
    }

    if (sentAt) {
      dataToUpdate.sentAt = new Date(sentAt);
    }

    // Allow updating other fields (AUD-C04: restricted to allowed fields only)
    const allowedFields = ['title', 'message', 'recipient', 'template'];
    for (const field of allowedFields) {
      if (otherFields[field] !== undefined) {
        dataToUpdate[field] = otherFields[field];
      }
    }

    const updatedNotification = await db.notification.update({
      where: { id },
      data: dataToUpdate,
    });

    return NextResponse.json({
      success: true,
      data: updatedNotification,
    });

  } catch (error) {
    logger.error('Error updating notification:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao atualizar notificação'] },
      { status: 500 }
    );
  }
}
