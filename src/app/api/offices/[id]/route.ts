import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const auth = await requireAuth(request)
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status })
    }

    const office = await db.office.findUnique({
      where: { id },
    })

    if (!office) {
      return NextResponse.json({ success: false, error: 'Oficina não encontrada' }, { status: 404 })
    }

    // Users can only access their own office
    if (office.id !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 })
    }

    return NextResponse.json({
      success: true,
      data: {
        id: office.id,
        name: office.name,
        cnpj: office.cnpj,
        email: office.email,
        phone: office.phone,
        address: office.address,
        city: office.city,
        state: office.state,
        zipCode: office.zipCode,
        logo: office.logo,
        active: office.active,
      },
    })
  } catch (error) {
    logger.error('Office GET error: [REDACTED]', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 })
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const auth = await requireAuth(request)
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status })
    }

    // Users can only update their own office
    if (id !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 })
    }

    // ============================================================================
    // SECURITY FIX: Only ADMIN or OWNER can update office details
    // ============================================================================
    if (auth.payload.role === 'EMPLOYEE') {
      return NextResponse.json({ success: false, error: 'Funcionários não podem alterar dados da oficina' }, { status: 403 })
    }

    const body = await request.json()
    const { name, email, phone, address, city, state, zipCode } = body

    // ============================================================================
    // SECURITY FIX: Validate input lengths to prevent excessive data
    // ============================================================================
    const MAX_FIELD_LENGTH = 200;
    const fields = { name, email, phone, address, city, state, zipCode };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined && value !== null && String(value).length > MAX_FIELD_LENGTH) {
        return NextResponse.json(
          { success: false, error: `Campo ${key} excede o tamanho máximo permitido` },
          { status: 400 }
        );
      }
    }

    const office = await db.office.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(state !== undefined && { state }),
        ...(zipCode !== undefined && { zipCode }),
      },
    })

    return NextResponse.json({
      success: true,
      data: {
        id: office.id,
        name: office.name,
        cnpj: office.cnpj,
        email: office.email,
        phone: office.phone,
        address: office.address,
        city: office.city,
        state: office.state,
        zipCode: office.zipCode,
        logo: office.logo,
        active: office.active,
      },
    })
  } catch (error) {
    logger.error('Office PUT error: [REDACTED]', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ success: false, error: 'Erro interno do servidor' }, { status: 500 })
  }
}
