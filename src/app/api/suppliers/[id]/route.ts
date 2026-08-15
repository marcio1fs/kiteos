import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth, auditLog } from '@/lib/auth';
import { isValidCNPJ } from '@/lib/server-validators';

// SEC-08 FIX: Migrated from verifyToken+getTokenFromHeaders to requireAuth
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

    const supplier = await db.supplier.findUnique({
      where: { id },
      include: {
        parts: {
          where: { deleted: false },
          select: {
            id: true,
            sku: true,
            description: true,
            quantity: true,
            salePrice: true,
          },
          take: 20,
          orderBy: { description: 'asc' },
        },
        invoices: {
          where: { deleted: false },
          select: {
            id: true,
            numero: true,
            dataEmissao: true,
            totalNf: true,
            status: true,
          },
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        _count: {
          select: { parts: { where: { deleted: false } } },
        },
      },
    });

    if (!supplier || supplier.deleted) {
      return NextResponse.json({ success: false, error: 'Fornecedor não encontrado' }, { status: 404 });
    }

    // Validate office belongs to user
    if (auth.payload.officeId !== supplier.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    return NextResponse.json({ success: true, data: supplier });
  } catch (error) {
    logger.error('Get supplier error:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}

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

    const existing = await db.supplier.findUnique({ where: { id } });

    if (!existing || existing.deleted) {
      return NextResponse.json({ success: false, error: 'Fornecedor não encontrado' }, { status: 404 });
    }

    if (auth.payload.officeId !== existing.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Check CNPJ uniqueness if changing
    if (body.cnpj && body.cnpj !== existing.cnpj) {
      // Validate CNPJ format
      if (!isValidCNPJ(body.cnpj)) {
        return NextResponse.json(
          { success: false, error: 'CNPJ inválido' },
          { status: 400 }
        );
      }
      const duplicate = await db.supplier.findFirst({
        where: {
          cnpj: body.cnpj,
          officeId: existing.officeId,
          deleted: false,
          id: { not: id },
        },
      });
      if (duplicate) {
        return NextResponse.json(
          { success: false, error: 'CNPJ já cadastrado neste escritório' },
          { status: 409 }
        );
      }
    }

    const supplier = await db.supplier.update({
      where: { id },
      data: {
        ...(body.cnpj !== undefined && { cnpj: body.cnpj }),
        ...(body.razaoSocial !== undefined && { razaoSocial: body.razaoSocial }),
        ...(body.nomeFantasia !== undefined && { nomeFantasia: body.nomeFantasia || null }),
        ...(body.email !== undefined && { email: body.email || null }),
        ...(body.phone !== undefined && { phone: body.phone || null }),
        ...(body.address !== undefined && { address: body.address || null }),
        ...(body.city !== undefined && { city: body.city || null }),
        ...(body.state !== undefined && { state: body.state || null }),
        ...(body.zipCode !== undefined && { zipCode: body.zipCode || null }),
        ...(body.ie !== undefined && { ie: body.ie || null }),
      },
    });

    await auditLog({
      action: 'UPDATE',
      entity: 'Supplier',
      entityId: supplier.id,
      details: JSON.stringify({ razaoSocial: supplier.razaoSocial, updatedFields: Object.keys(body) }),
      userId: auth.payload.userId,
      officeId: existing.officeId,
    });

    return NextResponse.json({ success: true, data: supplier });
  } catch (error) {
    logger.error('Update supplier error:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}

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

    const existing = await db.supplier.findUnique({ where: { id } });

    if (!existing || existing.deleted) {
      return NextResponse.json({ success: false, error: 'Fornecedor não encontrado' }, { status: 404 });
    }

    if (auth.payload.officeId !== existing.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 });
    }

    // Soft delete supplier
    await db.supplier.update({
      where: { id },
      data: { deleted: true },
    });

    await auditLog({
      action: 'DELETE',
      entity: 'Supplier',
      entityId: id,
      details: JSON.stringify({ razaoSocial: existing.razaoSocial, cnpj: existing.cnpj }),
      userId: auth.payload.userId,
      officeId: existing.officeId,
    });

    return NextResponse.json({ success: true, data: { message: 'Fornecedor removido com sucesso' } });
  } catch (error) {
    logger.error('Delete supplier error:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 });
  }
}
