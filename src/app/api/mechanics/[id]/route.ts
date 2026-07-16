import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'

// GET /api/mechanics/[id] - Get mechanic detail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request)
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status })
    }

    const { id } = await params
    const mechanic = await db.mechanic.findUnique({
      where: { id },
      include: {
        serviceItems: {
          where: { deleted: false, type: 'SERVICO' },
          include: { serviceOrder: { select: { number: true, status: true, createdAt: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    })

    if (!mechanic || mechanic.deleted) {
      return NextResponse.json({ success: false, error: 'Mecânico não encontrado' }, { status: 404 })
    }

    if (mechanic.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 })
    }

    return NextResponse.json({ success: true, data: mechanic })
  } catch (error) {
    console.error('Error getting mechanic:', error)
    return NextResponse.json({ success: false, error: 'Erro ao buscar mecânico' }, { status: 500 })
  }
}

// PUT /api/mechanics/[id] - Update mechanic
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request)
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status })
    }

    const { id } = await params
    const body = await request.json()
    const { name, cpf, phone, email, specialty, commissionPct, active } = body

    const existing = await db.mechanic.findUnique({ where: { id } })
    if (!existing || existing.deleted) {
      return NextResponse.json({ success: false, error: 'Mecânico não encontrado' }, { status: 404 })
    }

    if (existing.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 })
    }

    // Validate commission percentage
    if (commissionPct !== undefined && (commissionPct < 0 || commissionPct > 100)) {
      return NextResponse.json({ success: false, error: 'Percentual de comissão deve ser entre 0 e 100' }, { status: 400 })
    }

    const mechanic = await db.mechanic.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(cpf !== undefined && { cpf: cpf || null }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(email !== undefined && { email: email || null }),
        ...(specialty !== undefined && { specialty: specialty || null }),
        ...(commissionPct !== undefined && { commissionPct }),
        ...(active !== undefined && { active }),
      },
    })

    return NextResponse.json({ success: true, data: mechanic })
  } catch (error) {
    console.error('Error updating mechanic:', error)
    return NextResponse.json({ success: false, error: 'Erro ao atualizar mecânico' }, { status: 500 })
  }
}

// DELETE /api/mechanics/[id] - Soft delete mechanic
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAuth(request)
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status })
    }

    const { id } = await params

    const existing = await db.mechanic.findUnique({ where: { id } })
    if (!existing || existing.deleted) {
      return NextResponse.json({ success: false, error: 'Mecânico não encontrado' }, { status: 404 })
    }

    if (existing.officeId !== auth.payload.officeId) {
      return NextResponse.json({ success: false, error: 'Acesso negado' }, { status: 403 })
    }

    await db.mechanic.update({
      where: { id },
      data: { deleted: true },
    })

    return NextResponse.json({ success: true, data: { id } })
  } catch (error) {
    console.error('Error deleting mechanic:', error)
    return NextResponse.json({ success: false, error: 'Erro ao excluir mecânico' }, { status: 500 })
  }
}
