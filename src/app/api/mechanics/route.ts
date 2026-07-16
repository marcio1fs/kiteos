import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { isValidCPF } from '@/lib/server-validators'
import { requireAuth } from '@/lib/auth'

// GET /api/mechanics - List mechanics
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const officeId = searchParams.get('officeId')
    const search = searchParams.get('search')
    const active = searchParams.get('active')

    if (!officeId) {
      return NextResponse.json({ success: false, error: 'officeId é obrigatório' }, { status: 400 })
    }

    const auth = await requireAuth(request, officeId)
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status })
    }

    const where: Prisma.MechanicWhereInput = {
      officeId,
      deleted: false,
    }

    if (active === 'true') where.active = true
    if (active === 'false') where.active = false

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { specialty: { contains: search } },
        { phone: { contains: search } },
        { cpf: { contains: search } },
      ]
    }

    const mechanics = await db.mechanic.findMany({
      where,
      include: {
        _count: { select: { serviceItems: { where: { deleted: false } } } },
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ success: true, data: mechanics })
  } catch (error) {
    console.error('Error listing mechanics:', error)
    return NextResponse.json({ success: false, error: 'Erro ao listar mecânicos' }, { status: 500 })
  }
}

// POST /api/mechanics - Create mechanic
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { officeId, name, cpf, phone, email, specialty, commissionPct } = body

    if (!officeId || !name) {
      return NextResponse.json({ success: false, error: 'officeId e nome são obrigatórios' }, { status: 400 })
    }

    const auth = await requireAuth(request, officeId)
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status })
    }

    // Validate CPF if provided
    if (cpf && !isValidCPF(cpf)) {
      return NextResponse.json({ success: false, error: 'CPF inválido' }, { status: 400 })
    }

    // Validate commission percentage (0-100)
    const pct = commissionPct ?? 0
    if (pct < 0 || pct > 100) {
      return NextResponse.json({ success: false, error: 'Percentual de comissão deve ser entre 0 e 100' }, { status: 400 })
    }

    const mechanic = await db.mechanic.create({
      data: {
        name,
        cpf: cpf || null,
        phone: phone || null,
        email: email || null,
        specialty: specialty || null,
        commissionPct: pct,
        officeId,
      },
    })

    return NextResponse.json({ success: true, data: mechanic }, { status: 201 })
  } catch (error) {
    console.error('Error creating mechanic:', error)
    return NextResponse.json({ success: false, error: 'Erro ao criar mecânico' }, { status: 500 })
  }
}
