import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { isValidNCM, isValidCFOP } from '@/lib/server-validators';
import { requireAuth } from '@/lib/auth';

// GET /api/parts - List parts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const officeId = searchParams.get('officeId');
    const search = searchParams.get('search');
    const lowStock = searchParams.get('lowStock');

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

    const where: Prisma.PartWhereInput = {
      officeId,
      deleted: false,
    };

    if (search) {
      where.OR = [
        { description: { contains: search } },
        { sku: { contains: search } },
        { ncm: { contains: search } },
        { location: { contains: search } },
      ];
    }

    // Low stock filter: parts where quantity <= minQuantity
    if (lowStock === 'true') {
      // SECURITY FIX: Add limit to low stock query to prevent memory exhaustion (#64)
      // Note: Field comparison (quantity <= minQuantity) requires app-level filtering in Prisma/SQLite
      const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
      const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));

      const allParts = await db.part.findMany({
        where: {
          officeId,
          deleted: false,
          ...(search
            ? {
                OR: [
                  { description: { contains: search } },
                  { sku: { contains: search } },
                  { ncm: { contains: search } },
                  { location: { contains: search } },
                ],
              }
            : {}),
        },
        select: {
          id: true, sku: true, description: true, ncm: true, cfop: true,
          unit: true, quantity: true, minQuantity: true, costPrice: true, salePrice: true,
          location: true, batch: true, validity: true, cst: true, csosn: true,
          supplierId: true, officeId: true,
          supplier: {
            select: { id: true, razaoSocial: true, nomeFantasia: true },
          },
        },
        orderBy: { description: 'asc' },
      });

      const lowStockParts = allParts.filter(
        (part) => parseFloat(String(part.quantity)) <= parseFloat(String(part.minQuantity))
      );

      // Apply pagination to filtered results
      const total = lowStockParts.length;
      const paginatedParts = lowStockParts.slice((page - 1) * limit, page * limit);

      return NextResponse.json({
        success: true,
        data: paginatedParts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
          hasMore: page * limit < total,
        },
      });
    }

    // SECURITY FIX: Add pagination to prevent memory exhaustion (#64)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50', 10)));
    const skip = (page - 1) * limit;

    const [parts, total] = await Promise.all([
      db.part.findMany({
        where,
        include: {
          supplier: {
            select: { id: true, razaoSocial: true, nomeFantasia: true },
          },
        },
        orderBy: { description: 'asc' },
        skip,
        take: limit,
      }),
      db.part.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: parts,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    });
  } catch (error) {
    console.error('Error listing parts: [REDACTED]');
    return NextResponse.json(
      { success: false, error: 'Erro ao listar peças' },
      { status: 500 }
    );
  }
}

// POST /api/parts - Create part
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      officeId,
      sku,
      description,
      ncm,
      cfop,
      unit,
      quantity,
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

    // Validate required fields
    if (!officeId || !sku || !description) {
      return NextResponse.json(
        { success: false, error: 'officeId, sku e description são obrigatórios' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    // Validate NCM if provided
    if (ncm && !isValidNCM(ncm)) {
      return NextResponse.json(
        { success: false, error: 'NCM deve ter 8 dígitos' },
        { status: 400 }
      );
    }

    // Validate CFOP if provided
    if (cfop && !isValidCFOP(cfop)) {
      return NextResponse.json(
        { success: false, error: 'CFOP deve ter 4 dígitos e começar com 1 a 7' },
        { status: 400 }
      );
    }

    // Validate SKU uniqueness per office
    const existingSku = await db.part.findFirst({
      where: {
        sku,
        officeId,
        deleted: false,
      },
    });

    if (existingSku) {
      return NextResponse.json(
        { success: false, error: `SKU "${sku}" já existe nesta oficina` },
        { status: 409 }
      );
    }

    // Validate supplier if provided
    if (supplierId) {
      const supplier = await db.supplier.findFirst({
        where: { id: supplierId, officeId, deleted: false },
      });
      if (!supplier) {
        return NextResponse.json(
          { success: false, error: 'Fornecedor não encontrado' },
          { status: 404 }
        );
      }
    }

    const part = await db.part.create({
      data: {
        sku,
        description,
        ncm: ncm || null,
        cfop: cfop || null,
        unit: unit || 'UN',
        quantity: quantity || 0,
        minQuantity: minQuantity || 0,
        costPrice: costPrice || 0,
        salePrice: salePrice || 0,
        location: location || null,
        batch: batch || null,
        validity: validity ? new Date(validity) : null,
        cst: cst || null,
        csosn: csosn || null,
        supplierId: supplierId || null,
        officeId,
      },
      include: {
        supplier: {
          select: { id: true, razaoSocial: true, nomeFantasia: true },
        },
      },
    });

    // Create audit log
    await db.auditLog.create({
      data: {
        action: 'CREATE',
        entity: 'Part',
        entityId: part.id,
        details: JSON.stringify({ sku, description }),
        officeId,
      },
    });

    return NextResponse.json({ success: true, data: part }, { status: 201 });
  } catch (error) {
    console.error('Error creating part: [REDACTED]');
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        return NextResponse.json(
          { success: false, error: 'SKU já existe nesta oficina' },
          { status: 409 }
        );
      }
    }
    return NextResponse.json(
      { success: false, error: 'Erro ao criar peça' },
      { status: 500 }
    );
  }
}
