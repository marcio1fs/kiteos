import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }

    const { searchParams } = new URL(request.url);
    const ncm = searchParams.get('ncm');
    const cfop = searchParams.get('cfop');
    const state = searchParams.get('state');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    const where: Record<string, unknown> = {
      active: true,
      officeId: auth.payload.officeId, // TAX-01/SEC-07 FIX: Add officeId filter to GET
    };

    if (ncm) {
      where.ncm = { startsWith: ncm };
    }
    if (cfop) {
      where.cfop = cfop;
    }
    if (state) {
      where.state = state;
    }

    const [rules, total] = await Promise.all([
      db.taxRule.findMany({
        where,
        orderBy: [{ ncm: 'asc' }, { cfop: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.taxRule.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        rules,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });

  } catch (error) {
    logger.error('Error listing tax rules:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao listar regras fiscais'] },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }

    // TAX-01/SEC-07 FIX: Use auth.payload.officeId instead of body officeId
    const officeId = auth.payload.officeId;

    const body = await request.json();
    const {
      ncm,
      cfop,
      cst,
      csosn,
      aliqIcms,
      aliqIpi,
      aliqPis,
      aliqCofins,
      state,
    } = body;

    const errors: string[] = [];

    if (!ncm) errors.push('ncm é obrigatório');
    if (!cfop) errors.push('cfop é obrigatório');
    if (aliqIcms === undefined || aliqIcms === null) errors.push('aliqIcms é obrigatório');
    if (aliqIpi === undefined || aliqIpi === null) errors.push('aliqIpi é obrigatório');
    if (aliqPis === undefined || aliqPis === null) errors.push('aliqPis é obrigatório');
    if (aliqCofins === undefined || aliqCofins === null) errors.push('aliqCofins é obrigatório');

    // Validate NCM format (8 digits)
    if (ncm && !/^\d{8}$/.test(ncm)) {
      errors.push('NCM deve ter 8 dígitos');
    }

    // Validate CFOP format (4 digits)
    if (cfop && !/^\d{4}$/.test(cfop)) {
      errors.push('CFOP deve ter 4 dígitos');
    }

    // Validate state (2 letters)
    const stateValue = state || 'BA';
    if (!/^[A-Z]{2}$/.test(stateValue)) {
      errors.push('state deve ter 2 letras (UF)');
    }

    if (errors.length > 0) {
      return NextResponse.json({ success: false, errors }, { status: 400 });
    }

    // Check for existing rule with same ncm+cfop+state
    const existing = await db.taxRule.findFirst({
      where: { ncm, cfop, state: stateValue, officeId },
    });

    if (existing) {
      return NextResponse.json(
        { success: false, errors: [`Regra fiscal já existe para NCM=${ncm}, CFOP=${cfop}, UF=${stateValue}`] },
        { status: 409 }
      );
    }

    const rule = await db.taxRule.create({
      data: {
        ncm,
        cfop,
        cst: cst || null,
        csosn: csosn || null,
        aliqIcms: parseFloat(String(aliqIcms)),
        aliqIpi: parseFloat(String(aliqIpi)),
        aliqPis: parseFloat(String(aliqPis)),
        aliqCofins: parseFloat(String(aliqCofins)),
        state: stateValue,
        active: true,
        officeId, // TAX-01/SEC-07 FIX: Use auth.payload.officeId
      },
    });

    return NextResponse.json({
      success: true,
      data: rule,
    }, { status: 201 });

  } catch (error) {
    logger.error('Error creating tax rule:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao criar regra fiscal'] },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, errors: [auth.error.message] }, { status: auth.error.status });
    }

    const body = await request.json();
    const { id, ncm, cfop, cst, csosn, aliqIcms, aliqIpi, aliqPis, aliqCofins, state, active } = body;

    if (!id) {
      return NextResponse.json(
        { success: false, errors: ['id é obrigatório para atualização'] },
        { status: 400 }
      );
    }

    const existing = await db.taxRule.findFirst({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, errors: ['Regra fiscal não encontrada'] },
        { status: 404 }
      );
    }

    // TAX-01/SEC-07 FIX: Verify officeId ownership
    if (existing.officeId !== auth.payload.officeId) {
      return NextResponse.json(
        { success: false, errors: ['Acesso negado a esta regra fiscal'] },
        { status: 403 }
      );
    }

    // Build update data
    const dataToUpdate: Record<string, unknown> = {};

    if (ncm !== undefined) dataToUpdate.ncm = ncm;
    if (cfop !== undefined) dataToUpdate.cfop = cfop;
    if (cst !== undefined) dataToUpdate.cst = cst;
    if (csosn !== undefined) dataToUpdate.csosn = csosn;
    if (aliqIcms !== undefined) dataToUpdate.aliqIcms = parseFloat(String(aliqIcms));
    if (aliqIpi !== undefined) dataToUpdate.aliqIpi = parseFloat(String(aliqIpi));
    if (aliqPis !== undefined) dataToUpdate.aliqPis = parseFloat(String(aliqPis));
    if (aliqCofins !== undefined) dataToUpdate.aliqCofins = parseFloat(String(aliqCofins));
    if (state !== undefined) dataToUpdate.state = state;
    if (active !== undefined) dataToUpdate.active = active;

    // Check for duplicate if ncm/cfop/state is being changed
    if (ncm || cfop || state) {
      const checkNcm = ncm || existing.ncm;
      const checkCfop = cfop || existing.cfop;
      const checkState = state || existing.state;

      const duplicate = await db.taxRule.findFirst({
        where: {
          ncm: checkNcm,
          cfop: checkCfop,
          state: checkState,
          id: { not: id },
        },
      });

      if (duplicate) {
        return NextResponse.json(
          { success: false, errors: [`Regra fiscal já existe para NCM=${checkNcm}, CFOP=${checkCfop}, UF=${checkState}`] },
          { status: 409 }
        );
      }
    }

    const updatedRule = await db.taxRule.update({
      where: { id },
      data: dataToUpdate,
    });

    return NextResponse.json({
      success: true,
      data: updatedRule,
    });

  } catch (error) {
    logger.error('Error updating tax rule:', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, errors: ['Erro interno ao atualizar regra fiscal'] },
      { status: 500 }
    );
  }
}
