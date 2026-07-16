'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuthStore, useNavStore, apiFetch } from '@/lib/store'
import {
  ClipboardList,
  DollarSign,
  AlertTriangle,
  CreditCard,
  Wrench,
  ArrowUpRight,
  ArrowDownRight,
  Clock,
  Package,
  TrendingUp,
  Printer,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { printReport, buildReportHeader, fmtCurrency } from '@/lib/print-utils'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
} from 'recharts'

// Types
interface KPIData {
  osAbertas: number
  faturamentoMensal: number
  estoqueCritico: number
  planoAtual: string
}

interface ServiceOrder {
  id: string
  number: string
  status: string
  description: string | null
  totalAmount: number
  client: { id: string; name: string }
  vehicle: { id: string; plate: string; brand?: string; model?: string }
  createdAt: string
}

interface FinancialDashboard {
  contasReceberPendentes: number
  contasPagarPendentes: number
  totalRecebidoMes: number
  totalPagoMes: number
  saldoMes: number
  overdueCount: number
  pendingCount: number
  cashFlowSummary: { date: string; receitas: number; despesas: number; saldo: number }[]
}

interface StockAlert {
  id: string
  description: string
  currentQuantity: number
  minQuantity: number
  severity: 'CRITICAL' | 'WARNING'
  sku: string
  unit: string
}

interface Subscription {
  plan: string
  status: string
  monthlyPrice: number
}

// Helpers
function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
  })
}

const statusLabels: Record<string, string> = {
  ABERTA: 'Aberta',
  EM_EXECUCAO: 'Em Execução',
  FINALIZADA: 'Finalizada',
  PAGA: 'Paga',
  CANCELADA: 'Cancelada',
}

const statusColors: Record<string, string> = {
  ABERTA: 'bg-emerald-100 text-emerald-700',
  EM_EXECUCAO: 'bg-amber-100 text-amber-700',
  FINALIZADA: 'bg-blue-100 text-blue-700',
  PAGA: 'bg-zinc-100 text-zinc-600',
  CANCELADA: 'bg-red-100 text-red-700',
}

const planLabels: Record<string, string> = {
  FREE: 'Gratuito',
  PRO: 'Profissional',
  PRO_PLUS: 'Pro Plus',
  PREMIUM: 'Premium',
}

export function DashboardModule() {
  const { user, office } = useAuthStore()
  const { setPage } = useNavStore()

  // Data states
  const [loading, setLoading] = useState(true)
  const [kpi, setKpi] = useState<KPIData | null>(null)
  const [osByStatus, setOsByStatus] = useState<{ name: string; count: number }[]>([])
  const [cashFlow, setCashFlow] = useState<{ date: string; receitas: number; despesas: number; saldo: number }[]>([])
  const [recentOrders, setRecentOrders] = useState<ServiceOrder[]>([])
  const [financialData, setFinancialData] = useState<FinancialDashboard | null>(null)
  const [stockAlerts, setStockAlerts] = useState<StockAlert[]>([])
  const [subscription, setSubscription] = useState<Subscription | null>(null)

  const fetchDashboard = useCallback(async () => {
    if (!office?.id) return
    setLoading(true)
    try {
      const [osRes, financialRes, alertsRes, subsRes] = await Promise.all([
        apiFetch(`/api/service-orders?officeId=${office.id}`).catch(() => ({ success: false, data: [] })),
        apiFetch(`/api/financial/dashboard?officeId=${office.id}`).catch(() => ({ success: false, data: null })),
        apiFetch(`/api/stock-alerts?officeId=${office.id}`).catch(() => ({ success: false, data: { alerts: [], total: 0 } })),
        apiFetch(`/api/subscriptions?officeId=${office.id}`).catch(() => ({ success: false, data: [] })),
      ])

      // Process service orders
      if (osRes.success && Array.isArray(osRes.data)) {
        const orders: ServiceOrder[] = osRes.data
        const openStatuses = ['ABERTA', 'EM_EXECUCAO']
        const openCount = orders.filter((o) => openStatuses.includes(o.status)).length
        setRecentOrders(orders.slice(0, 5))

        // Group by status for chart
        const statusMap: Record<string, number> = {}
        for (const order of orders) {
          const label = statusLabels[order.status] || order.status
          statusMap[label] = (statusMap[label] || 0) + 1
        }
        setOsByStatus(
          Object.entries(statusMap).map(([name, count]) => ({ name, count }))
        )

        setKpi((prev) => ({
          osAbertas: openCount,
          faturamentoMensal: prev?.faturamentoMensal || 0,
          estoqueCritico: prev?.estoqueCritico || 0,
          planoAtual: prev?.planoAtual || 'FREE',
        }))
      }

      // Process financial data
      if (financialRes.success && financialRes.data) {
        const fd = financialRes.data as FinancialDashboard
        setFinancialData(fd)
        setCashFlow(fd.cashFlowSummary || [])
        setKpi((prev) => ({
          osAbertas: prev?.osAbertas || 0,
          faturamentoMensal: fd.totalRecebidoMes || 0,
          estoqueCritico: prev?.estoqueCritico || 0,
          planoAtual: prev?.planoAtual || 'FREE',
        }))
      }

      // Process stock alerts
      if (alertsRes.success && alertsRes.data) {
        const alertData = alertsRes.data
        const alerts = alertData.alerts || []
        setStockAlerts(alerts.slice(0, 5))
        setKpi((prev) => ({
          osAbertas: prev?.osAbertas || 0,
          faturamentoMensal: prev?.faturamentoMensal || 0,
          estoqueCritico: alertData.total || 0,
          planoAtual: prev?.planoAtual || 'FREE',
        }))
      }

      // Process subscription
      if (subsRes.success && Array.isArray(subsRes.data) && subsRes.data.length > 0) {
        const activeSub = subsRes.data.find(
          (s: Subscription) => s.status === 'ATIVA' || s.status === 'TRIAL'
        ) || subsRes.data[0]
        setSubscription(activeSub)
        setKpi((prev) => ({
          osAbertas: prev?.osAbertas || 0,
          faturamentoMensal: prev?.faturamentoMensal || 0,
          estoqueCritico: prev?.estoqueCritico || 0,
          planoAtual: activeSub.plan || 'FREE',
        }))
      }
    } catch (error) {
      console.error('Error fetching dashboard:', error)
    } finally {
      setLoading(false)
    }
  }, [office?.id])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  // Print dashboard
  const handlePrintDashboard = () => {
    const officeName = office?.name || 'KiteOS'
    const header = buildReportHeader('Dashboard - Resumo Geral', officeName)
    // KPI cards
    const kpiHtml = `
      <div class="summary-grid">
        <div class="summary-card green"><div class="label">OS Abertas</div><div class="value text-green">${kpi?.osAbertas ?? 0}</div></div>
        <div class="summary-card blue"><div class="label">Faturamento Mensal</div><div class="value text-blue">${fmtCurrency(kpi?.faturamentoMensal ?? 0)}</div></div>
        <div class="summary-card amber"><div class="label">Estoque Crítico</div><div class="value text-amber">${kpi?.estoqueCritico ?? 0} itens</div></div>
        <div class="summary-card green"><div class="label">Plano Atual</div><div class="value text-green">${planLabels[kpi?.planoAtual || 'FREE'] || 'Gratuito'}</div></div>
      </div>
    `
    // Financial summary
    const finHtml = `
      <div class="section-title">Resumo Financeiro</div>
      <div class="summary-grid">
        <div class="summary-card green"><div class="label">Recebido</div><div class="value text-green">${fmtCurrency(financialData?.totalRecebidoMes || 0)}</div></div>
        <div class="summary-card red"><div class="label">Pago</div><div class="value text-red">${fmtCurrency(financialData?.totalPagoMes || 0)}</div></div>
        <div class="summary-card blue"><div class="label">A Receber</div><div class="value text-blue">${fmtCurrency(financialData?.contasReceberPendentes || 0)}</div></div>
        <div class="summary-card amber"><div class="label">A Pagar</div><div class="value text-amber">${fmtCurrency(financialData?.contasPagarPendentes || 0)}</div></div>
      </div>
    `
    // Recent orders
    let orderRows = ''
    recentOrders.forEach((o) => {
      orderRows += `<tr>
        <td>${o.number}</td>
        <td>${o.client.name}</td>
        <td>${o.vehicle.plate}</td>
        <td>${statusLabels[o.status] || o.status}</td>
        <td class="text-right">${fmtCurrency(o.totalAmount)}</td>
      </tr>`
    })
    const ordersHtml = orderRows ? `
      <div class="section-title">Ordens Recentes</div>
      <table>
        <thead><tr><th>Número</th><th>Cliente</th><th>Veículo</th><th>Status</th><th class="text-right">Valor</th></tr></thead>
        <tbody>${orderRows}</tbody>
      </table>
    ` : ''
    // Alerts
    let alertRows = ''
    stockAlerts.forEach((a) => {
      alertRows += `<tr>
        <td>${a.description}</td>
        <td class="text-center text-red">${a.currentQuantity}</td>
        <td class="text-center">${a.minQuantity}</td>
        <td>${a.severity === 'CRITICAL' ? 'CRÍTICO' : 'ATENÇÃO'}</td>
      </tr>`
    })
    const alertsHtml = alertRows || financialData?.overdueCount ? `
      <div class="section-title">Alertas</div>
      ${financialData && financialData.overdueCount > 0 ? `<p style="color:#dc2626;font-size:12px;margin-bottom:8px;">${financialData.overdueCount} título(s) em atraso</p>` : ''}
      ${alertRows ? `<table><thead><tr><th>Peça</th><th class="text-center">Atual</th><th class="text-center">Mínimo</th><th>Severidade</th></tr></thead><tbody>${alertRows}</tbody></table>` : ''}
    ` : ''
    printReport({ title: 'Dashboard - Resumo Geral', contentHtml: header + kpiHtml + finHtml + ordersHtml + alertsHtml })
  }

  // KPI Cards config
  const kpiCards: { title: string; value: string | number; icon: typeof ClipboardList; color: string; bgColor: string; iconColor: string; badgeBg: string; format: (v: string | number) => string; subtitle: string }[] = [
    {
      title: 'OS Abertas',
      value: kpi?.osAbertas ?? 0,
      icon: ClipboardList,
      color: 'emerald',
      bgColor: 'bg-emerald-50',
      iconColor: 'text-emerald-600',
      badgeBg: 'bg-emerald-100 text-emerald-700',
      format: (v: string | number) => String(v),
      subtitle: 'Em andamento',
    },
    {
      title: 'Faturamento Mensal',
      value: kpi?.faturamentoMensal ?? 0,
      icon: DollarSign,
      color: 'green',
      bgColor: 'bg-green-50',
      iconColor: 'text-green-600',
      badgeBg: 'bg-green-100 text-green-700',
      format: (v: string | number) => formatCurrency(Number(v)),
      subtitle: 'Receita do mês',
    },
    {
      title: 'Estoque Crítico',
      value: kpi?.estoqueCritico ?? 0,
      icon: AlertTriangle,
      color: 'orange',
      bgColor: 'bg-orange-50',
      iconColor: 'text-orange-600',
      badgeBg: 'bg-orange-100 text-orange-700',
      format: (v: string | number) => `${v} itens`,
      subtitle: 'Abaixo do mínimo',
    },
    {
      title: 'Assinatura',
      value: planLabels[kpi?.planoAtual || 'FREE'] || 'Gratuito',
      icon: CreditCard,
      color: 'blue',
      bgColor: 'bg-sky-50',
      iconColor: 'text-sky-600',
      badgeBg: 'bg-sky-100 text-sky-700',
      format: (v: string | number) => String(v),
      subtitle: subscription ? `R$ ${subscription.monthlyPrice.toFixed(2)}/mês` : 'Plano atual',
    },
  ]

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight">Dashboard</h1>
            <p className="text-zinc-500 text-sm mt-0.5">
              {getGreeting()}, <span className="font-medium text-zinc-700">{user?.name || 'Usuário'}</span>
            </p>
          </div>
          <Button
            onClick={() => setPage('service-orders')}
            variant="outline"
            size="sm"
            className="w-fit border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          >
            <ClipboardList className="w-4 h-4" />
            Nova OS
          </Button>
          <Button
            onClick={handlePrintDashboard}
            variant="outline"
            size="sm"
            className="w-fit border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          >
            <Printer className="w-4 h-4" />
            Imprimir
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <Card key={i} className="border-zinc-200/60">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between">
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-8 w-32" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                      <Skeleton className="h-10 w-10 rounded-lg" />
                    </div>
                  </CardContent>
                </Card>
              ))
            : kpiCards.map((card) => {
                const Icon = card.icon
                const isString = typeof card.value === 'string'
                return (
                  <Card key={card.title} className="border-zinc-200/60 hover:shadow-md transition-shadow">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-zinc-500 font-medium">{card.title}</p>
                          <p className="text-2xl font-bold text-zinc-900 mt-1 truncate">
                            {isString ? card.value : card.format(card.value as number)}
                          </p>
                          <p className="text-xs text-zinc-400 mt-1">{card.subtitle}</p>
                        </div>
                        <div className={`w-10 h-10 rounded-lg ${card.bgColor} flex items-center justify-center shrink-0 ml-3`}>
                          <Icon className={`w-5 h-5 ${card.iconColor}`} />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
        </div>

        {/* Charts Section */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Bar Chart - OS by Status */}
          <Card className="border-zinc-200/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-zinc-900">
                Ordens por Status
              </CardTitle>
              <CardDescription className="text-xs text-zinc-400">
                Distribuição das ordens de serviço
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="h-[260px] flex items-center justify-center">
                  <Skeleton className="h-[240px] w-full" />
                </div>
              ) : osByStatus.length === 0 ? (
                <div className="h-[260px] flex flex-col items-center justify-center text-zinc-400">
                  <ClipboardList className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm">Nenhuma ordem encontrada</p>
                </div>
              ) : (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={osByStatus} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 11, fill: '#71717a' }}
                        axisLine={{ stroke: '#e4e4e7' }}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#71717a' }}
                        axisLine={false}
                        tickLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #e4e4e7',
                          borderRadius: '8px',
                          fontSize: '12px',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        }}
                      />
                      <Bar
                        dataKey="count"
                        name="Ordens"
                        fill="#059669"
                        radius={[6, 6, 0, 0]}
                        maxBarSize={48}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Line Chart - Revenue */}
          <Card className="border-zinc-200/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold text-zinc-900">
                Fluxo de Caixa (30 dias)
              </CardTitle>
              <CardDescription className="text-xs text-zinc-400">
                Receitas e despesas dos últimos 30 dias
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="h-[260px] flex items-center justify-center">
                  <Skeleton className="h-[240px] w-full" />
                </div>
              ) : cashFlow.length === 0 ? (
                <div className="h-[260px] flex flex-col items-center justify-center text-zinc-400">
                  <TrendingUp className="w-10 h-10 mb-2 opacity-40" />
                  <p className="text-sm">Sem dados financeiros no período</p>
                </div>
              ) : (
                <div className="h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={cashFlow} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: '#71717a' }}
                        axisLine={{ stroke: '#e4e4e7' }}
                        tickLine={false}
                        tickFormatter={(val: string) => {
                          const d = val.split('-')
                          return `${d[2]}/${d[1]}`
                        }}
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: '#71717a' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(val: number) => {
                          if (val >= 1000) return `${(val / 1000).toFixed(0)}k`
                          return String(val)
                        }}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#fff',
                          border: '1px solid #e4e4e7',
                          borderRadius: '8px',
                          fontSize: '12px',
                          boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                        }}
                        formatter={(value: number, name: string) => [
                          formatCurrency(value),
                          name === 'receitas' ? 'Receitas' : name === 'despesas' ? 'Despesas' : 'Saldo',
                        ]}
                      />
                      <Line
                        type="monotone"
                        dataKey="receitas"
                        name="receitas"
                        stroke="#059669"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="despesas"
                        name="despesas"
                        stroke="#ef4444"
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                      <Line
                        type="monotone"
                        dataKey="saldo"
                        name="saldo"
                        stroke="#3b82f6"
                        strokeWidth={2}
                        strokeDasharray="4 4"
                        dot={false}
                        activeDot={{ r: 4, strokeWidth: 0 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Recent Activity + Alerts */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Recent Service Orders */}
          <Card className="border-zinc-200/60 lg:col-span-2">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-zinc-900">
                    Ordens Recentes
                  </CardTitle>
                  <CardDescription className="text-xs text-zinc-400">
                    Últimas ordens de serviço criadas
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 text-xs"
                  onClick={() => setPage('service-orders')}
                >
                  Ver todas
                  <ArrowUpRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-50/50">
                      <Skeleton className="h-9 w-9 rounded-lg" />
                      <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-4 w-40" />
                        <Skeleton className="h-3 w-28" />
                      </div>
                      <Skeleton className="h-5 w-16 rounded-full" />
                    </div>
                  ))}
                </div>
              ) : recentOrders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-zinc-400">
                  <Wrench className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-sm">Nenhuma ordem de serviço encontrada</p>
                </div>
              ) : (
                <div className="space-y-1 max-h-80 overflow-y-auto">
                  {recentOrders.map((order) => (
                    <div
                      key={order.id}
                      className="flex items-center gap-3 p-3 rounded-lg hover:bg-zinc-50 transition-colors cursor-pointer"
                    >
                      <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                        <ClipboardList className="w-4 h-4 text-emerald-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-zinc-800 truncate">
                            {order.number}
                          </p>
                        </div>
                        <p className="text-xs text-zinc-400 truncate">
                          {order.client.name} • {order.vehicle.plate}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <Badge
                          variant="secondary"
                          className={`text-[10px] px-2 py-0 h-5 font-medium ${statusColors[order.status] || 'bg-zinc-100 text-zinc-600'}`}
                        >
                          {statusLabels[order.status] || order.status}
                        </Badge>
                        <span className="text-xs font-medium text-zinc-700">
                          {formatCurrency(order.totalAmount)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Alerts */}
          <Card className="border-zinc-200/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold text-zinc-900">
                    Alertas
                  </CardTitle>
                  <CardDescription className="text-xs text-zinc-400">
                    Atenção necessária
                  </CardDescription>
                </div>
                {stockAlerts.length > 0 && (
                  <Badge variant="secondary" className="bg-orange-100 text-orange-700 text-[10px]">
                    {stockAlerts.length}
                  </Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="p-3 rounded-lg bg-zinc-50/50">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4 rounded" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                      <Skeleton className="h-3 w-32 mt-2" />
                    </div>
                  ))}
                </div>
              ) : stockAlerts.length === 0 && (!financialData || financialData.overdueCount === 0) ? (
                <div className="flex flex-col items-center justify-center py-8 text-zinc-400">
                  <AlertTriangle className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-sm">Nenhum alerta no momento</p>
                </div>
              ) : (
                <div className="space-y-2 max-h-80 overflow-y-auto">
                  {/* Overdue payments */}
                  {financialData && financialData.overdueCount > 0 && (
                    <div className="p-3 rounded-lg bg-red-50 border border-red-100">
                      <div className="flex items-center gap-2">
                        <ArrowDownRight className="w-4 h-4 text-red-500" />
                        <span className="text-sm font-medium text-red-700">
                          Pagamentos Atrasados
                        </span>
                      </div>
                      <p className="text-xs text-red-600 mt-1">
                        {financialData.overdueCount} título{financialData.overdueCount > 1 ? 's' : ''} em atraso
                      </p>
                    </div>
                  )}

                  {/* Pending payments */}
                  {financialData && financialData.pendingCount > 0 && (
                    <div className="p-3 rounded-lg bg-amber-50 border border-amber-100">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-amber-500" />
                        <span className="text-sm font-medium text-amber-700">
                          Pagamentos Pendentes
                        </span>
                      </div>
                      <p className="text-xs text-amber-600 mt-1">
                        {financialData.pendingCount} título{financialData.pendingCount > 1 ? 's' : ''} aguardando
                      </p>
                    </div>
                  )}

                  {/* Stock alerts */}
                  {stockAlerts.map((alert) => (
                    <div
                      key={alert.id}
                      className={`p-3 rounded-lg border ${
                        alert.severity === 'CRITICAL'
                          ? 'bg-red-50 border-red-100'
                          : 'bg-amber-50 border-amber-100'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Package
                          className={`w-4 h-4 ${
                            alert.severity === 'CRITICAL' ? 'text-red-500' : 'text-amber-500'
                          }`}
                        />
                        <span
                          className={`text-sm font-medium ${
                            alert.severity === 'CRITICAL' ? 'text-red-700' : 'text-amber-700'
                          }`}
                        >
                          {alert.description}
                        </span>
                      </div>
                      <p
                        className={`text-xs mt-1 ${
                          alert.severity === 'CRITICAL' ? 'text-red-600' : 'text-amber-600'
                        }`}
                      >
                        Estoque: {alert.currentQuantity} {alert.unit} (mín: {alert.minQuantity})
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Financial Summary */}
        <Card className="border-zinc-200/60">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-semibold text-zinc-900">
                  Resumo Financeiro
                </CardTitle>
                <CardDescription className="text-xs text-zinc-400">
                  Visão geral do mês atual
                </CardDescription>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 text-xs"
                onClick={() => setPage('financial')}
              >
                Ver detalhes
                <ArrowUpRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            {loading ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="p-4 rounded-lg bg-zinc-50/50">
                    <Skeleton className="h-3 w-20 mb-2" />
                    <Skeleton className="h-6 w-28" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-lg bg-emerald-50/70">
                  <p className="text-xs font-medium text-zinc-500">Recebido</p>
                  <p className="text-lg font-bold text-emerald-700 mt-1">
                    {formatCurrency(financialData?.totalRecebidoMes || 0)}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-red-50/70">
                  <p className="text-xs font-medium text-zinc-500">Pago</p>
                  <p className="text-lg font-bold text-red-700 mt-1">
                    {formatCurrency(financialData?.totalPagoMes || 0)}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-sky-50/70">
                  <p className="text-xs font-medium text-zinc-500">A Receber</p>
                  <p className="text-lg font-bold text-sky-700 mt-1">
                    {formatCurrency(financialData?.contasReceberPendentes || 0)}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-amber-50/70">
                  <p className="text-xs font-medium text-zinc-500">A Pagar</p>
                  <p className="text-lg font-bold text-amber-700 mt-1">
                    {formatCurrency(financialData?.contasPagarPendentes || 0)}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
