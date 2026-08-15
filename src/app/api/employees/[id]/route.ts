import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { hashPassword, requireAuth, validatePasswordStrength } from '@/lib/auth';

// GET /api/employees/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const user = await db.user.findFirst({
      where: {
        id,
        officeId,
        deleted: false,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        commissionRate: true,
        active: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Funcionário não encontrado' },
        { status: 404 }
      );
    }

    // Fetch seller's sales list for detailed commission breakdown
    const sales = await db.sale.findMany({
      where: {
        userId: id,
        officeId,
        deleted: false,
        status: 'PAGA'
      },
      select: {
        id: true,
        number: true,
        totalAmount: true,
        discount: true,
        paymentMethod: true,
        createdAt: true,
        client: {
          select: { name: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    const commissionRate = Number(user.commissionRate || 0);
    const salesWithCommission = sales.map(s => {
      const amount = Number(s.totalAmount);
      return {
        ...s,
        totalAmount: amount,
        commissionAmount: Math.round((amount * (commissionRate / 100)) * 100) / 100
      };
    });

    return NextResponse.json({
      success: true,
      data: {
        ...user,
        commissionRate,
        sales: salesWithCommission
      },
    });
  } catch (error) {
    logger.error('Error getting employee details:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao buscar detalhes do funcionário' },
      { status: 500 }
    );
  }
}

// PUT /api/employees/[id] - Update employee details / active status / reset password
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { officeId, name, email, role, active, password, commissionRate } = body;

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    // Require ADMIN or OWNER
    const auth = await requireAuth(request, officeId, 'ADMIN');
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    // Find existing employee
    const existingUser = await db.user.findFirst({
      where: { id, officeId, deleted: false },
    });

    if (!existingUser) {
      return NextResponse.json(
        { success: false, error: 'Funcionário não encontrado' },
        { status: 404 }
      );
    }

    // Prevent non-owners from modifying owner accounts
    if (existingUser.role === 'OWNER' && auth.payload.role !== 'OWNER') {
      return NextResponse.json(
        { success: false, error: 'Apenas o proprietário pode alterar a conta de outro proprietário' },
        { status: 403 }
      );
    }

    const updateData: any = {};

    if (name) updateData.name = String(name).trim();

    if (email) {
      const cleanEmail = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
        return NextResponse.json(
          { success: false, error: 'E-mail inválido' },
          { status: 400 }
        );
      }

      // Check duplicate email
      const duplicateEmail = await db.user.findFirst({
        where: {
          email: cleanEmail,
          officeId,
          deleted: false,
          NOT: { id },
        },
      });

      if (duplicateEmail) {
        return NextResponse.json(
          { success: false, error: 'Outro funcionário já utiliza este e-mail' },
          { status: 400 }
        );
      }

      updateData.email = cleanEmail;
    }

    if (role && ['EMPLOYEE', 'ADMIN'].includes(role)) {
      if (existingUser.role !== 'OWNER') {
        updateData.role = role;
      }
    }

    if (typeof active === 'boolean') {
      // Prevent deactivating the logged in user or last owner
      if (id === auth.payload.userId && !active) {
        return NextResponse.json(
          { success: false, error: 'Você não pode desativar seu próprio usuário' },
          { status: 400 }
        );
      }
      updateData.active = active;
    }

    if (typeof commissionRate === 'number' || typeof commissionRate === 'string') {
      const rate = Number(commissionRate);
      if (!isNaN(rate) && rate >= 0 && rate <= 100) {
        updateData.commissionRate = rate;
      }
    }

    if (password) {
      const passwordValidation = validatePasswordStrength(password);
      if (!passwordValidation.valid) {
        return NextResponse.json(
          { success: false, error: passwordValidation.errors.join('. ') },
          { status: 400 }
        );
      }
      updateData.password = await hashPassword(password);
    }

    const updatedUser = await db.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        commissionRate: true,
        active: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: updatedUser,
    });
  } catch (error) {
    logger.error('Error updating employee:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao atualizar funcionário' },
      { status: 500 }
    );
  }
}

// DELETE /api/employees/[id] - Soft delete employee
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');

    if (!officeId) {
      return NextResponse.json(
        { success: false, error: 'officeId é obrigatório' },
        { status: 400 }
      );
    }

    // Require ADMIN or OWNER
    const auth = await requireAuth(request, officeId, 'ADMIN');
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    if (id === auth.payload.userId) {
      return NextResponse.json(
        { success: false, error: 'Você não pode remover seu próprio usuário' },
        { status: 400 }
      );
    }

    const targetUser = await db.user.findFirst({
      where: { id, officeId, deleted: false },
    });

    if (!targetUser) {
      return NextResponse.json(
        { success: false, error: 'Funcionário não encontrado' },
        { status: 404 }
      );
    }

    if (targetUser.role === 'OWNER') {
      return NextResponse.json(
        { success: false, error: 'O proprietário da oficina não pode ser excluído' },
        { status: 403 }
      );
    }

    // Soft delete
    await db.user.update({
      where: { id },
      data: { deleted: true, active: false },
    });

    return NextResponse.json({
      success: true,
      message: 'Funcionário removido com sucesso',
    });
  } catch (error) {
    logger.error('Error deleting employee:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao remover funcionário' },
      { status: 500 }
    );
  }
}
