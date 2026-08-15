import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { db } from '@/lib/db'
import { requireAuth } from '@/lib/auth'
import { Prisma } from '@prisma/client'

// GET /api/mechanics/commission - Monthly commission report
// AUD-C03 FIX: Added requireAuth — was completely unauthenticated
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request)
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status })
    }

    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month') // format: YYYY-MM (e.g. 2026-05)
    const mechanicId = searchParams.get('mechanicId') // optional: filter by mechanic

    // AUD-C03 FIX: Use authenticated user's officeId instead of query param
    const officeId = auth.payload.officeId

    // Parse month or default to current month
    let startDate: Date
    let endDate: Date

    if (month) {
      const [year, mon] = month.split('-').map(Number)
      startDate = new Date(year, mon - 1, 1)
      endDate = new Date(year, mon, 1)
    } else {
      const now = new Date()
      startDate = new Date(now.getFullYear(), now.getMonth(), 1)
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    }

    // Get all mechanics for the office
    const mechanicsWhere: Prisma.MechanicWhereInput = {
      officeId,
      deleted: false,
    }
    if (mechanicId) mechanicsWhere.id = mechanicId

    const mechanics = await db.mechanic.findMany({
      where: mechanicsWhere,
      orderBy: { name: 'asc' },
    })

    // For each mechanic, get their service items in the period
    const report: {
      mechanic: { id: string; name: string; specialty: string | null; commissionPct: number; phone: string | null; active: boolean };
      totalServices: number;
      totalValue: number;
      totalCommission: number;
      items: any[];
    }[] = []

    for (const mechanic of mechanics) {
      const serviceItems = await db.serviceOrderItem.findMany({
        where: {
          mechanicId: mechanic.id,
          deleted: false,
          type: 'SERVICO',
          createdAt: {
            gte: startDate,
            lt: endDate,
          },
          serviceOrder: {
            status: { in: ['FINALIZADA', 'PAGA'] },
            deleted: false,
          },
        },
        include: {
          serviceOrder: {
            select: {
              number: true,
              status: true,
              client: { select: { name: true } },
              vehicle: { select: { plate: true, model: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      })

      const totalServices = serviceItems.length
      const totalValue = serviceItems.reduce((sum, item) => sum + Number(item.totalPrice), 0)
      const totalCommission = serviceItems.reduce((sum, item) => sum + Number(item.commissionValue), 0)

      report.push({
        mechanic: {
          id: mechanic.id,
          name: mechanic.name,
          specialty: mechanic.specialty,
          commissionPct: Number(mechanic.commissionPct),
          phone: mechanic.phone,
          active: mechanic.active,
        },
        totalServices,
        totalValue,
        totalCommission,
        items: serviceItems,
      })
    }

    // Grand totals
    const grandTotalServices = report.reduce((sum, r) => sum + r.totalServices, 0)
    const grandTotalValue = report.reduce((sum, r) => sum + r.totalValue, 0)
    const grandTotalCommission = report.reduce((sum, r) => sum + r.totalCommission, 0)

    return NextResponse.json({
      success: true,
      data: {
        period: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          label: startDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
        },
        mechanics: report,
        totals: {
          totalServices: grandTotalServices,
          totalValue: grandTotalValue,
          totalCommission: grandTotalCommission,
        },
      },
    })
  } catch (error) {
    logger.error('Error getting commission report:', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ success: false, error: 'Erro ao gerar relatório de comissões' }, { status: 500 })
  }
}
