import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const status = searchParams.get('status');
    const type = searchParams.get('type');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

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

    const where: Record<string, unknown> = {
      officeId,
      // QRY-03: Notification model has no 'deleted' field, so we can't filter by it
    };

    if (status) {
      where.status = status;
    }
    if (type) {
      where.type = type;
    }

    const [notifications, total] = await Promise.all([
      db.notification.findMany({
        where,
        include: {
          serviceOrder: {
            select: {
              id: true,
              number: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.notification.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        notifications,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });

  } catch (error) {
    logger.error('Error listing notifications:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao listar notificações'] },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      officeId,
      type,
      title,
      message,
      recipient,
      template,
      serviceOrderId,
    } = body;

    const errors: string[] = [];

    if (!officeId) errors.push('officeId é obrigatório');
    if (!type) errors.push('type é obrigatório (WHATSAPP, EMAIL, SYSTEM)');
    if (!title) errors.push('title é obrigatório');
    if (!message) errors.push('message é obrigatório');

    if (!['WHATSAPP', 'EMAIL', 'SYSTEM'].includes(type)) {
      errors.push('type deve ser WHATSAPP, EMAIL ou SYSTEM');
    }

    if (errors.length > 0) {
      return NextResponse.json({ success: false, errors }, { status: 400 });
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }

    // Validate serviceOrderId if provided
    if (serviceOrderId) {
      const serviceOrder = await db.serviceOrder.findFirst({
        where: { id: serviceOrderId, officeId, deleted: false },
      });
      if (!serviceOrder) {
        return NextResponse.json(
          { success: false, errors: ['Ordem de serviço não encontrada'] },
          { status: 404 }
        );
      }
    }

    const notification = await db.notification.create({
      data: {
        type,
        template: template || null,
        title,
        message,
        recipient: recipient || null,
        status: 'PENDENTE',
        serviceOrderId: serviceOrderId || null,
        officeId,
      },
    });

    return NextResponse.json({
      success: true,
      data: notification,
    }, { status: 201 });

  } catch (error) {
    logger.error('Error creating notification:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao criar notificação'] },
      { status: 500 }
    );
  }
}
