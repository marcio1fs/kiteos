import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { hashPassword, requireAuth, validatePasswordStrength } from '@/lib/auth';

// GET /api/employees - List employees/users for the office
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const search = searchParams.get('search');
    const role = searchParams.get('role');
    const active = searchParams.get('active');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

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

    const where: any = {
      officeId,
      deleted: false,
    };

    if (role) {
      where.role = role;
    }

    if (active !== null && active !== undefined && active !== '') {
      where.active = active === 'true';
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const users = await db.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        commissionRate: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            sales: {
              where: { deleted: false }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
    });

    // Build date filter for sales if period is passed
    const salesDateWhere: any = {};
    if (startDate || endDate) {
      salesDateWhere.createdAt = {};
      if (startDate) salesDateWhere.createdAt.gte = new Date(startDate);
      if (endDate) salesDateWhere.createdAt.lte = new Date(endDate);
    }

    // Calculate total sales amount and commission for each employee/seller
    const employeesWithMetrics = await Promise.all(
      users.map(async (u) => {
        const salesAggregate = await db.sale.aggregate({
          where: {
            userId: u.id,
            officeId,
            deleted: false,
            status: 'PAGA',
            ...salesDateWhere,
          },
          _sum: {
            totalAmount: true
          },
          _count: {
            id: true
          }
        });

        const totalSalesAmount = Number(salesAggregate._sum.totalAmount || 0);
        const commissionRate = Number(u.commissionRate || 0);
        const commissionAmount = Math.round((totalSalesAmount * (commissionRate / 100)) * 100) / 100;

        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          commissionRate,
          active: u.active,
          createdAt: u.createdAt,
          updatedAt: u.updatedAt,
          totalSalesCount: salesAggregate._count.id || u._count.sales,
          totalSalesAmount,
          commissionAmount,
        };
      })
    );

    return NextResponse.json({
      success: true,
      data: employeesWithMetrics,
    });
  } catch (error) {
    logger.error('Error fetching employees:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao listar funcionários' },
      { status: 500 }
    );
  }
}

// POST /api/employees - Create new employee/user
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, name, email, password, role = 'EMPLOYEE', commissionRate = 0 } = body;

    if (!officeId || !name || !email || !password) {
      return NextResponse.json(
        { success: false, error: 'officeId, name, email e password são obrigatórios' },
        { status: 400 }
      );
    }

    // Security: Only ADMIN or OWNER can create employees
    const auth = await requireAuth(request, officeId, 'ADMIN');
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    // Validate email format
    const cleanEmail = String(email).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return NextResponse.json(
        { success: false, error: 'E-mail inválido' },
        { status: 400 }
      );
    }

    // Validate password strength
    const passwordValidation = validatePasswordStrength(password);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { success: false, error: passwordValidation.errors.join('. ') },
        { status: 400 }
      );
    }

    // Check if user with same email exists in this office
    const existingUser = await db.user.findFirst({
      where: {
        email: cleanEmail,
        officeId,
        deleted: false,
      },
    });

    if (existingUser) {
      return NextResponse.json(
        { success: false, error: 'Já existe um funcionário cadastrado com este e-mail nesta oficina' },
        { status: 400 }
      );
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Validate role
    const validRole = ['EMPLOYEE', 'ADMIN'].includes(role) ? role : 'EMPLOYEE';

    // Create user
    const newUser = await db.user.create({
      data: {
        name: String(name).trim(),
        email: cleanEmail,
        password: hashedPassword,
        role: validRole,
        commissionRate: Number(commissionRate || 0),
        officeId,
        active: true,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        commissionRate: true,
        active: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: newUser,
    });
  } catch (error) {
    logger.error('Error creating employee:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao criar funcionário' },
      { status: 500 }
    );
  }
}
