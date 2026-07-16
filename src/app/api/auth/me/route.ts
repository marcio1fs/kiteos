import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// SEC-01 FIX: Replaced verifyToken + getTokenFromHeaders with requireAuth
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    const user = await db.user.findUnique({
      where: { id: auth.payload.userId },
      include: { office: true },
    });

    if (!user || user.deleted || !user.active) {
      return NextResponse.json(
        { success: false, error: 'Usuário não encontrado ou inativo' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: {
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          active: user.active,
          officeId: user.officeId,
          createdAt: user.createdAt,
        },
        office: {
          id: user.office.id,
          name: user.office.name,
          cnpj: user.office.cnpj,
          email: user.office.email,
          phone: user.office.phone,
          address: user.office.address,
          city: user.office.city,
          state: user.office.state,
          zipCode: user.office.zipCode,
          logo: user.office.logo,
          active: user.office.active,
        },
      },
    });
  } catch (error) {
    console.error('Me error:', error);
    return NextResponse.json(
      { success: false, error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
