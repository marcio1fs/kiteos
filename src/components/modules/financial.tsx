'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import {
  DollarSign,
  Plus,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Wallet,
  CalendarDays,
  Search,
  Loader2,
  CreditCard,
  Banknote,
  QrCode,
  Receipt,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Clock,
  Printer,
} from 'lucide-react'
import { printReport, buildReportHeader, fmtCurrency, fmtDate } from '@/lib/print-utils'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

// =============================================
// TYPES
// =============================================
interface Supplier {
  id: string
  razaoSocial: string
  nomeFantasia?: string | null
  cnpj: string
}

interface FinancialEntry {
  id: string
  type: string // PAGAR, RECEBER
  category: string | null // ASSINATURA, OS, NF, OUTROS
  description: string
  amount: number
  discount: number
  interest: number
  totalAmount: number
  status: string // PENDENTE, PAGO, ATRASADO, CANCELADO
  dueDate: string
  paymentDate: string | null
  paymentMethod: string | null
  reference: string | null
  supplierId: string | null
  supplier?: Supplier | null
  createdAt: string
  updatedAt: string
}

interface DashboardData {
  contasReceberPendentes: number
  contasPagarPendentes: number
  totalRecebidoMes: number
  totalPagoMes: number
  saldoMes: number
  overdueCount: number
  pendingCount: number
  cashFlowSummary: Array<{
    date: string
    receitas: number
    despesas: number
    saldo: number
  }>
}

interface ReportData {
  period: string
  totals: {
    amount: number
    discount: number
    interest: number
    totalAmount: number
    count: number
  }
  byType: {
    PAGAR: { amount: number; totalAmount: number; count: number }
    RECEBER: { amount: number; totalAmount: number; count: number }
  }
  categories: Record<string, {
    amount: number
    discount: number
    interest: number
    totalAmount: number
    count: number
  }>
}

// =============================================
// HELPERS
// =============================================
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}

function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'PENDENTE':
      return <Badge className="bg-yellow-100 text-yellow-700 border-yellow-200 hover:bg-yellow-100 gap-1"><Clock className="h-3 w-3" /> Pendente</Badge>
    case 'PAGO':
      return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 gap-1"><CheckCircle2 className="h-3 w-3" /> Pago</Badge>
    case 'ATRASADO':
      return <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100 gap-1"><AlertCircle className="h-3 w-3" /> Atrasado</Badge>
    case 'CANCELADO':
      return <Badge className="bg-zinc-100 text-zinc-500 border-zinc-200 hover:bg-zinc-100">Cancelado</Badge>
    default:
      return <Badge variant="outline">{status}</Badge>
  }
}

function getPaymentMethodIcon(method: string | null) {
  switch (method) {
    case 'PIX':
      return <QrCode className="h-3.5 w-3.5" />
    case 'CARTAO':
      return <CreditCard className="h-3.5 w-3.5" />
    case 'DINHEIRO':
      return <Banknote className="h-3.5 w-3.5" />
    default:
      return null
  }
}

// =============================================
// EMPTY ENTRY FORM
// =============================================
function emptyEntryForm(): EntryForm {
  return {
    type: 'PAGAR',
    category: 'OUTROS',
    description: '',
    amount: 0,
    discount: 0,
    interest: 0,
    dueDate: new Date().toISOString().split('T')[0],
    paymentMethod: '',
    reference: '',
    supplierId: '',
  }
}

interface EntryForm {
  type: string
  category: string
  description: string
  amount: number
  discount: number
  interest: number
  dueDate: string
  paymentMethod: string
  reference: string
  supplierId: string
}

// =============================================
// MAIN COMPONENT
// =============================================
export default function FinancialModule() {
  const { office } = useAuthStore()
  const officeId = office?.id || ''

  // --- Dashboard ---
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loadingDashboard, setLoadingDashboard] = useState(false)

  // --- Entries ---
  const [entriesPagar, setEntriesPagar] = useState<FinancialEntry[]>([])
  const [entriesReceber, setEntriesReceber] = useState<FinancialEntry[]>([])
  const [loadingPagar, setLoadingPagar] = useState(false)
  const [loadingReceber, setLoadingReceber] = useState(false)

  // --- Filters ---
  const [filterStatusPagar, setFilterStatusPagar] = useState<string>('all')
  const [filterStatusReceber, setFilterStatusReceber] = useState<string>('all')
  const [filterDateFromPagar, setFilterDateFromPagar] = useState('')
  const [filterDateToPagar, setFilterDateToPagar] = useState('')
  const [filterDateFromReceber, setFilterDateFromReceber] = useState('')
  const [filterDateToReceber, setFilterDateToReceber] = useState('')

  // --- Pagination ---
  const [pagePagar, setPagePagar] = useState(1)
  const [pageReceber, setPageReceber] = useState(1)
  const pageSize = 8

  // --- Suppliers ---
  const [suppliers, setSuppliers] = useState<Supplier[]>([])

  // --- Dialogs ---
  const [showEntryDialog, setShowEntryDialog] = useState(false)
  const [showPayDialog, setShowPayDialog] = useState(false)
  const [payingEntry, setPayingEntry] = useState<FinancialEntry | null>(null)
  const [paymentMethod, setPaymentMethod] = useState('')
  const [entryForm, setEntryForm] = useState<EntryForm>(emptyEntryForm())
  const [saving, setSaving] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)

  // --- Reports ---
  const [reportPeriod, setReportPeriod] = useState('monthly')
  const [reportDateFrom, setReportDateFrom] = useState('')
  const [reportDateTo, setReportDateTo] = useState('')
  const [reportCategory, setReportCategory] = useState('all')
  const [reportData, setReportData] = useState<ReportData[]>([])
  const [reportOverall, setReportOverall] = useState<{ amount: number; discount: number; interest: number; totalAmount: number; count: number } | null>(null)
  const [loadingReport, setLoadingReport] = useState(false)

  // --- Fetch Dashboard ---
  const fetchDashboard = useCallback(async () => {
    if (!officeId) return
    setLoadingDashboard(true)
    try {
      const res = await apiFetch(`/api/financial/dashboard?officeId=${officeId}`)
      if (res.success) {
        setDashboard(res.data)
      }
    } catch (err) {
      console.error('Erro ao buscar dashboard:', err)
    } finally {
      setLoadingDashboard(false)
    }
  }, [officeId])

  // --- Fetch Entries ---
  const fetchPagar = useCallback(async () => {
    if (!officeId) return
    setLoadingPagar(true)
    try {
      const params = new URLSearchParams({ officeId, type: 'PAGAR' })
      if (filterStatusPagar && filterStatusPagar !== 'all') params.set('status', filterStatusPagar)
      if (filterDateFromPagar) params.set('dateFrom', filterDateFromPagar)
      if (filterDateToPagar) params.set('dateTo', filterDateToPagar)
      const res = await apiFetch(`/api/financial?${params.toString()}`)
      if (res.success) setEntriesPagar(res.data)
    } catch (err) {
      console.error('Erro ao buscar contas a pagar:', err)
    } finally {
      setLoadingPagar(false)
    }
  }, [officeId, filterStatusPagar, filterDateFromPagar, filterDateToPagar])

  const fetchReceber = useCallback(async () => {
    if (!officeId) return
    setLoadingReceber(true)
    try {
      const params = new URLSearchParams({ officeId, type: 'RECEBER' })
      if (filterStatusReceber && filterStatusReceber !== 'all') params.set('status', filterStatusReceber)
      if (filterDateFromReceber) params.set('dateFrom', filterDateFromReceber)
      if (filterDateToReceber) params.set('dateTo', filterDateToReceber)
      const res = await apiFetch(`/api/financial?${params.toString()}`)
      if (res.success) setEntriesReceber(res.data)
    } catch (err) {
      console.error('Erro ao buscar contas a receber:', err)
    } finally {
      setLoadingReceber(false)
    }
  }, [officeId, filterStatusReceber, filterDateFromReceber, filterDateToReceber])

  // --- Fetch Suppliers ---
  const fetchSuppliers = useCallback(async () => {
    if (!officeId) return
    try {
      const res = await apiFetch(`/api/suppliers?officeId=${officeId}&limit=100`)
      if (res.success) setSuppliers(res.data)
    } catch (err) {
      console.error('Erro ao buscar fornecedores:', err)
    }
  }, [officeId])

  // --- Fetch Report ---
  const fetchReport = useCallback(async () => {
    if (!officeId) return
    setLoadingReport(true)
    try {
      const params = new URLSearchParams({ officeId, period: reportPeriod })
      if (reportDateFrom) params.set('dateFrom', reportDateFrom)
      if (reportDateTo) params.set('dateTo', reportDateTo)
      if (reportCategory && reportCategory !== 'all') params.set('category', reportCategory)
      const res = await apiFetch(`/api/financial/reports?${params.toString()}`)
      if (res.success) {
        setReportData(res.data.report)
        setReportOverall(res.data.overallTotals)
      }
    } catch (err) {
      console.error('Erro ao buscar relatório:', err)
    } finally {
      setLoadingReport(false)
    }
  }, [officeId, reportPeriod, reportDateFrom, reportDateTo, reportCategory])

  // --- Effects ---
  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  useEffect(() => {
    fetchPagar()
  }, [fetchPagar])

  useEffect(() => {
    fetchReceber()
  }, [fetchReceber])

  useEffect(() => {
    fetchSuppliers()
  }, [fetchSuppliers])

  useEffect(() => {
    fetchReport()
  }, [fetchReport])

  // --- Handlers ---
  const handleOpenNewEntry = (type?: string) => {
    setEntryForm({ ...emptyEntryForm(), type: type || 'PAGAR' })
    setShowEntryDialog(true)
  }

  const handleSaveEntry = async () => {
    if (!entryForm.description.trim() || entryForm.amount <= 0 || !entryForm.dueDate) return
    setSaving(true)
    try {
      const res = await apiFetch('/api/financial', {
        method: 'POST',
        body: JSON.stringify({
          officeId,
          type: entryForm.type,
          category: entryForm.category,
          description: entryForm.description,
          amount: entryForm.amount,
          discount: entryForm.discount,
          interest: entryForm.interest,
          dueDate: entryForm.dueDate,
          paymentMethod: entryForm.paymentMethod || null,
          reference: entryForm.reference || null,
          supplierId: entryForm.type === 'PAGAR' ? (entryForm.supplierId || null) : null,
        }),
      })
      if (res.success) {
        setShowEntryDialog(false)
        fetchPagar()
        fetchReceber()
        fetchDashboard()
      }
    } catch (err) {
      console.error('Erro ao criar entrada financeira:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleOpenPay = (entry: FinancialEntry) => {
    setPayingEntry(entry)
    setPaymentMethod('')
    setShowPayDialog(true)
  }

  const handleConfirmPay = async () => {
    if (!payingEntry) return
    setSavingPayment(true)
    try {
      const res = await apiFetch(`/api/financial/pay/${payingEntry.id}`, {
        method: 'PUT',
        body: JSON.stringify({ paymentMethod: paymentMethod || null }),
      })
      if (res.success) {
        setShowPayDialog(false)
        setPayingEntry(null)
        fetchPagar()
        fetchReceber()
        fetchDashboard()
      }
    } catch (err) {
      console.error('Erro ao pagar:', err)
    } finally {
      setSavingPayment(false)
    }
  }

  // --- Print Handlers ---
  const handlePrintPagar = () => {
    const officeName = office?.name || 'KiteOS'
    const header = buildReportHeader('Contas a Pagar', officeName)
    let rows = ''
    entriesPagar.forEach((e) => {
      rows += `<tr>
        <td>${e.description}</td>
        <td>${e.supplier?.nomeFantasia || e.supplier?.razaoSocial || '—'}</td>
        <td class="text-right text-red">${fmtCurrency(e.totalAmount)}</td>
        <td>${fmtDate(e.dueDate)}</td>
        <td>${e.status}</td>
      </tr>`
    })
    const total = entriesPagar.reduce((s, e) => s + e.totalAmount, 0)
    const table = `
      <table>
        <thead><tr>
          <th>Descrição</th><th>Fornecedor</th><th class="text-right">Valor</th><th>Vencimento</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${rows}
          <tr class="totals-row">
            <td colspan="2">TOTAL</td><td class="text-right text-red">${fmtCurrency(total)}</td><td colspan="2"></td>
          </tr>
        </tbody>
      </table>`
    printReport({ title: 'Contas a Pagar', contentHtml: header + table })
  }

  const handlePrintReceber = () => {
    const officeName = office?.name || 'KiteOS'
    const header = buildReportHeader('Contas a Receber', officeName)
    let rows = ''
    entriesReceber.forEach((e) => {
      rows += `<tr>
        <td>${e.description}</td>
        <td>${e.category || 'OUTROS'}</td>
        <td class="text-right text-green">${fmtCurrency(e.totalAmount)}</td>
        <td>${fmtDate(e.dueDate)}</td>
        <td>${e.status}</td>
      </tr>`
    })
    const total = entriesReceber.reduce((s, e) => s + e.totalAmount, 0)
    const table = `
      <table>
        <thead><tr>
          <th>Descrição</th><th>Categoria</th><th class="text-right">Valor</th><th>Vencimento</th><th>Status</th>
        </tr></thead>
        <tbody>
          ${rows}
          <tr class="totals-row">
            <td colspan="2">TOTAL</td><td class="text-right text-green">${fmtCurrency(total)}</td><td colspan="2"></td>
          </tr>
        </tbody>
      </table>`
    printReport({ title: 'Contas a Receber', contentHtml: header + table })
  }

  const handlePrintReport = () => {
    const officeName = office?.name || 'KiteOS'
    const periodLabel = reportPeriod === 'daily' ? 'Diário' : reportPeriod === 'monthly' ? 'Mensal' : 'Anual'
    const header = buildReportHeader('Relatório Financeiro', officeName, `Período: ${periodLabel}`)
    // Summary cards
    const summaryHtml = reportOverall ? `
      <div class="summary-grid">
        <div class="summary-card red"><div class="label">A Pagar</div><div class="value text-red">${fmtCurrency(reportOverall.amount)}</div></div>
        <div class="summary-card green"><div class="label">A Receber</div><div class="value text-green">${fmtCurrency(reportOverall.amount)}</div></div>
        <div class="summary-card blue"><div class="label">Descontos</div><div class="value text-blue">${fmtCurrency(reportOverall.discount)}</div></div>
        <div class="summary-card amber"><div class="label">Juros</div><div class="value text-amber">${fmtCurrency(reportOverall.interest)}</div></div>
        <div class="summary-card green"><div class="label">Total Geral</div><div class="value text-green">${fmtCurrency(reportOverall.totalAmount)}</div></div>
        <div class="summary-card blue"><div class="label">Quantidade</div><div class="value text-blue">${reportOverall.count}</div></div>
      </div>
    ` : ''
    // Main table
    let rows = ''
    reportData.forEach((row) => {
      rows += `<tr>
        <td>${row.period}</td>
        <td class="text-right text-red">${fmtCurrency(row.byType.PAGAR.totalAmount)}</td>
        <td class="text-right text-green">${fmtCurrency(row.byType.RECEBER.totalAmount)}</td>
        <td class="text-right">${fmtCurrency(row.totals.discount)}</td>
        <td class="text-right">${fmtCurrency(row.totals.interest)}</td>
        <td class="text-right font-bold">${fmtCurrency(row.totals.totalAmount)}</td>
        <td class="text-center">${row.totals.count}</td>
      </tr>`
    })
    const totalsRow = reportOverall ? `
      <tr class="totals-row">
        <td>TOTAL</td>
        <td class="text-right text-red">${fmtCurrency(0)}</td>
        <td class="text-right text-green">${fmtCurrency(0)}</td>
        <td class="text-right">${fmtCurrency(reportOverall.discount)}</td>
        <td class="text-right">${fmtCurrency(reportOverall.interest)}</td>
        <td class="text-right">${fmtCurrency(reportOverall.totalAmount)}</td>
        <td class="text-center">${reportOverall.count}</td>
      </tr>` : ''
    const table = `
      <table>
        <thead><tr>
          <th>Período</th><th class="text-right">A Pagar</th><th class="text-right">A Receber</th><th class="text-right">Desconto</th><th class="text-right">Juros</th><th class="text-right">Total</th><th class="text-center">Qtd</th>
        </tr></thead>
        <tbody>${rows}${totalsRow}</tbody>
      </table>`
    // Category breakdown
    let catRows = ''
    reportData.forEach((row) => {
      Object.entries(row.categories).forEach(([cat, data]) => {
        catRows += `<tr>
          <td>${row.period}</td>
          <td>${cat}</td>
          <td class="text-right">${fmtCurrency(data.amount)}</td>
          <td class="text-right">${fmtCurrency(data.discount)}</td>
          <td class="text-right">${fmtCurrency(data.interest)}</td>
          <td class="text-right font-bold">${fmtCurrency(data.totalAmount)}</td>
          <td class="text-center">${data.count}</td>
        </tr>`
      })
    })
    const catSection = catRows ? `
      <div class="section-title">Detalhamento por Categoria</div>
      <table>
        <thead><tr>
          <th>Período</th><th>Categoria</th><th class="text-right">Valor Bruto</th><th class="text-right">Desconto</th><th class="text-right">Juros</th><th class="text-right">Total</th><th class="text-center">Qtd</th>
        </tr></thead>
        <tbody>${catRows}</tbody>
      </table>` : ''
    printReport({ title: 'Relatório Financeiro', contentHtml: header + summaryHtml + table + catSection })
  }

  // --- Computed ---
  const totalAmount = entryForm.amount - entryForm.discount + entryForm.interest

  // Paginated entries
  const paginatedPagar = entriesPagar.slice((pagePagar - 1) * pageSize, pagePagar * pageSize)
  const paginatedReceber = entriesReceber.slice((pageReceber - 1) * pageSize, pageReceber * pageSize)

  // Recent entries for dashboard
  const recentEntries = [...entriesPagar, ...entriesReceber]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 10)

  // Cash flow chart data
  const chartData = (dashboard?.cashFlowSummary || []).map((item) => ({
    ...item,
    date: formatShortDate(item.date),
  }))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <DollarSign className="h-6 w-6 text-emerald-600" />
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Financeiro</h1>
      </div>

      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="overview">Visão Geral</TabsTrigger>
          <TabsTrigger value="pagar">Contas a Pagar</TabsTrigger>
          <TabsTrigger value="receber">Contas a Receber</TabsTrigger>
          <TabsTrigger value="relatorios">Relatórios</TabsTrigger>
        </TabsList>

        {/* ============================================= */}
        {/* VISÃO GERAL */}
        {/* ============================================= */}
        <TabsContent value="overview" className="space-y-4">
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/50 p-2.5">
                  <TrendingUp className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-emerald-600 font-medium">Total a Receber</p>
                  <p className="text-xl font-bold text-emerald-700">
                    {loadingDashboard ? <Loader2 className="h-4 w-4 animate-spin" /> : formatCurrency(dashboard?.contasReceberPendentes || 0)}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-red-200 bg-red-50/50 dark:bg-red-950/20 dark:border-red-900">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-full bg-red-100 dark:bg-red-900/50 p-2.5">
                  <TrendingDown className="h-5 w-5 text-red-600" />
                </div>
                <div>
                  <p className="text-xs text-red-600 font-medium">Total a Pagar</p>
                  <p className="text-xl font-bold text-red-700">
                    {loadingDashboard ? <Loader2 className="h-4 w-4 animate-spin" /> : formatCurrency(dashboard?.contasPagarPendentes || 0)}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-900">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-full bg-blue-100 dark:bg-blue-900/50 p-2.5">
                  <Wallet className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-blue-600 font-medium">Saldo do Mês</p>
                  <p className={`text-xl font-bold ${(dashboard?.saldoMes || 0) >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                    {loadingDashboard ? <Loader2 className="h-4 w-4 animate-spin" /> : formatCurrency(dashboard?.saldoMes || 0)}
                  </p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-emerald-200 bg-emerald-50/50 dark:bg-emerald-950/20 dark:border-emerald-900">
              <CardContent className="p-4 flex items-center gap-3">
                <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/50 p-2.5">
                  <DollarSign className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-xs text-emerald-600 font-medium">Receita Mensal</p>
                  <p className="text-xl font-bold text-emerald-700">
                    {loadingDashboard ? <Loader2 className="h-4 w-4 animate-spin" /> : formatCurrency(dashboard?.totalRecebidoMes || 0)}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Cash Flow Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-emerald-600" />
                Fluxo de Caixa (Últimos 30 dias)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <div className="flex items-center justify-center h-64 text-zinc-500">
                  <p>Sem dados de fluxo de caixa no período</p>
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={300}>
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorReceitas" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#059669" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#059669" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorDespesas" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#dc2626" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#dc2626" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#71717a" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#71717a" tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        formatCurrency(value),
                        name === 'receitas' ? 'Receitas' : name === 'despesas' ? 'Despesas' : 'Saldo',
                      ]}
                      labelFormatter={(label) => `Data: ${label}`}
                    />
                    <Legend
                      formatter={(value) => (value === 'receitas' ? 'Receitas' : value === 'despesas' ? 'Despesas' : 'Saldo')}
                    />
                    <Area type="monotone" dataKey="receitas" stroke="#059669" fillOpacity={1} fill="url(#colorReceitas)" />
                    <Area type="monotone" dataKey="despesas" stroke="#dc2626" fillOpacity={1} fill="url(#colorDespesas)" />
                    <Area type="monotone" dataKey="saldo" stroke="#3b82f6" fillOpacity={0} strokeDasharray="4 4" />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Recent Entries */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Receipt className="h-5 w-5 text-emerald-600" />
                Últimas Movimentações
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentEntries.length === 0 ? (
                <div className="flex items-center justify-center py-10 text-zinc-500">
                  <p>Nenhuma movimentação encontrada</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Vencimento</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {recentEntries.map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell>
                            {entry.type === 'RECEBER' ? (
                              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 gap-1">
                                <ArrowDownRight className="h-3 w-3" /> Receber
                              </Badge>
                            ) : (
                              <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100 gap-1">
                                <ArrowUpRight className="h-3 w-3" /> Pagar
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">{entry.description}</TableCell>
                          <TableCell className={`text-right font-medium ${entry.type === 'RECEBER' ? 'text-emerald-600' : 'text-red-600'}`}>
                            {formatCurrency(entry.totalAmount)}
                          </TableCell>
                          <TableCell className="text-sm">{formatDate(entry.dueDate)}</TableCell>
                          <TableCell>{getStatusBadge(entry.status)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================= */}
        {/* CONTAS A PAGAR */}
        {/* ============================================= */}
        <TabsContent value="pagar" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Contas a Pagar</h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handlePrintPagar} disabled={entriesPagar.length === 0} className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                <Printer className="h-4 w-4" />
                Imprimir
              </Button>
              <Button size="sm" onClick={() => handleOpenNewEntry('PAGAR')} className="bg-emerald-600 hover:bg-emerald-700 gap-1.5">
                <Plus className="h-4 w-4" />
                Novo Título
              </Button>
            </div>
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="w-full sm:w-48">
                  <Label className="text-xs mb-1">Status</Label>
                  <Select value={filterStatusPagar} onValueChange={setFilterStatusPagar}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="PENDENTE">Pendente</SelectItem>
                      <SelectItem value="PAGO">Pago</SelectItem>
                      <SelectItem value="ATRASADO">Atrasado</SelectItem>
                      <SelectItem value="CANCELADO">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-full sm:w-40">
                  <Label className="text-xs mb-1">De</Label>
                  <Input type="date" value={filterDateFromPagar} onChange={(e) => setFilterDateFromPagar(e.target.value)} />
                </div>
                <div className="w-full sm:w-40">
                  <Label className="text-xs mb-1">Até</Label>
                  <Input type="date" value={filterDateToPagar} onChange={(e) => setFilterDateToPagar(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              {loadingPagar ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                </div>
              ) : entriesPagar.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
                  <TrendingDown className="h-12 w-12 mb-3 opacity-40" />
                  <p className="text-lg font-medium">Nenhuma conta a pagar</p>
                  <p className="text-sm">Adicione um título clicando em &quot;Novo Título&quot;</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Descrição</TableHead>
                          <TableHead>Fornecedor</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                          <TableHead>Vencimento</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedPagar.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell className="max-w-[200px] truncate">{entry.description}</TableCell>
                            <TableCell className="max-w-[120px] truncate">
                              {entry.supplier?.nomeFantasia || entry.supplier?.razaoSocial || '—'}
                            </TableCell>
                            <TableCell className="text-right font-medium text-red-600">
                              {formatCurrency(entry.totalAmount)}
                            </TableCell>
                            <TableCell className="text-sm">{formatDate(entry.dueDate)}</TableCell>
                            <TableCell>{getStatusBadge(entry.status)}</TableCell>
                            <TableCell className="text-right">
                              {entry.status !== 'PAGO' && entry.status !== 'CANCELADO' && (
                                <Button size="sm" variant="outline" onClick={() => handleOpenPay(entry)} className="gap-1 text-emerald-600 border-emerald-200 hover:bg-emerald-50">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Pagar
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Pagination */}
                  <div className="flex items-center justify-between px-4 py-3 border-t">
                    <p className="text-sm text-zinc-500">{entriesPagar.length} título{entriesPagar.length !== 1 ? 's' : ''}</p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" disabled={pagePagar <= 1} onClick={() => setPagePagar(pagePagar - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm font-medium">{pagePagar} / {Math.max(1, Math.ceil(entriesPagar.length / pageSize))}</span>
                      <Button variant="outline" size="icon" disabled={pagePagar >= Math.ceil(entriesPagar.length / pageSize)} onClick={() => setPagePagar(pagePagar + 1)}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================= */}
        {/* CONTAS A RECEBER */}
        {/* ============================================= */}
        <TabsContent value="receber" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Contas a Receber</h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handlePrintReceber} disabled={entriesReceber.length === 0} className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                <Printer className="h-4 w-4" />
                Imprimir
              </Button>
              <Button size="sm" onClick={() => handleOpenNewEntry('RECEBER')} className="bg-emerald-600 hover:bg-emerald-700 gap-1.5">
                <Plus className="h-4 w-4" />
                Novo Título
              </Button>
            </div>
          </div>

          {/* Filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="w-full sm:w-48">
                  <Label className="text-xs mb-1">Status</Label>
                  <Select value={filterStatusReceber} onValueChange={setFilterStatusReceber}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todos</SelectItem>
                      <SelectItem value="PENDENTE">Pendente</SelectItem>
                      <SelectItem value="PAGO">Recebido</SelectItem>
                      <SelectItem value="ATRASADO">Atrasado</SelectItem>
                      <SelectItem value="CANCELADO">Cancelado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-full sm:w-40">
                  <Label className="text-xs mb-1">De</Label>
                  <Input type="date" value={filterDateFromReceber} onChange={(e) => setFilterDateFromReceber(e.target.value)} />
                </div>
                <div className="w-full sm:w-40">
                  <Label className="text-xs mb-1">Até</Label>
                  <Input type="date" value={filterDateToReceber} onChange={(e) => setFilterDateToReceber(e.target.value)} />
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardContent className="p-0">
              {loadingReceber ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                </div>
              ) : entriesReceber.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
                  <TrendingUp className="h-12 w-12 mb-3 opacity-40" />
                  <p className="text-lg font-medium">Nenhuma conta a receber</p>
                  <p className="text-sm">Adicione um título clicando em &quot;Novo Título&quot;</p>
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Descrição</TableHead>
                          <TableHead>Categoria</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                          <TableHead>Vencimento</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedReceber.map((entry) => (
                          <TableRow key={entry.id}>
                            <TableCell className="max-w-[200px] truncate">{entry.description}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{entry.category || 'OUTROS'}</Badge>
                            </TableCell>
                            <TableCell className="text-right font-medium text-emerald-600">
                              {formatCurrency(entry.totalAmount)}
                            </TableCell>
                            <TableCell className="text-sm">{formatDate(entry.dueDate)}</TableCell>
                            <TableCell>{getStatusBadge(entry.status)}</TableCell>
                            <TableCell className="text-right">
                              {entry.status !== 'PAGO' && entry.status !== 'CANCELADO' && (
                                <Button size="sm" variant="outline" onClick={() => handleOpenPay(entry)} className="gap-1 text-emerald-600 border-emerald-200 hover:bg-emerald-50">
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Receber
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {/* Pagination */}
                  <div className="flex items-center justify-between px-4 py-3 border-t">
                    <p className="text-sm text-zinc-500">{entriesReceber.length} título{entriesReceber.length !== 1 ? 's' : ''}</p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="icon" disabled={pageReceber <= 1} onClick={() => setPageReceber(pageReceber - 1)}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm font-medium">{pageReceber} / {Math.max(1, Math.ceil(entriesReceber.length / pageSize))}</span>
                      <Button variant="outline" size="icon" disabled={pageReceber >= Math.ceil(entriesReceber.length / pageSize)} onClick={() => setPageReceber(pageReceber + 1)}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================= */}
        {/* RELATÓRIOS */}
        {/* ============================================= */}
        <TabsContent value="relatorios" className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Relatórios Financeiros</h2>
            <Button size="sm" variant="outline" onClick={handlePrintReport} disabled={reportData.length === 0} className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
              <Printer className="h-4 w-4" />
              Imprimir Relatório
            </Button>
          </div>

          {/* Report filters */}
          <Card>
            <CardContent className="p-4">
              <div className="flex flex-col sm:flex-row gap-3 items-end">
                <div className="w-full sm:w-40">
                  <Label className="text-xs mb-1">Período</Label>
                  <Select value={reportPeriod} onValueChange={setReportPeriod}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Diário</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                      <SelectItem value="yearly">Anual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-full sm:w-40">
                  <Label className="text-xs mb-1">De</Label>
                  <Input type="date" value={reportDateFrom} onChange={(e) => setReportDateFrom(e.target.value)} />
                </div>
                <div className="w-full sm:w-40">
                  <Label className="text-xs mb-1">Até</Label>
                  <Input type="date" value={reportDateTo} onChange={(e) => setReportDateTo(e.target.value)} />
                </div>
                <div className="w-full sm:w-44">
                  <Label className="text-xs mb-1">Categoria</Label>
                  <Select value={reportCategory} onValueChange={setReportCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas</SelectItem>
                      <SelectItem value="ASSINATURA">Assinatura</SelectItem>
                      <SelectItem value="OS">Ordem de Serviço</SelectItem>
                      <SelectItem value="NF">Nota Fiscal</SelectItem>
                      <SelectItem value="OUTROS">Outros</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Report table */}
          <Card>
            <CardContent className="p-0">
              {loadingReport ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
                </div>
              ) : reportData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
                  <BarChart3 className="h-12 w-12 mb-3 opacity-40" />
                  <p className="text-lg font-medium">Sem dados para o período</p>
                  <p className="text-sm">Ajuste os filtros e tente novamente</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Período</TableHead>
                        <TableHead className="text-right">A Pagar</TableHead>
                        <TableHead className="text-right">A Receber</TableHead>
                        <TableHead className="text-right">Desconto</TableHead>
                        <TableHead className="text-right">Juros</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-center">Qtd</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportData.map((row) => (
                        <TableRow key={row.period}>
                          <TableCell className="font-medium">{row.period}</TableCell>
                          <TableCell className="text-right text-red-600">{formatCurrency(row.byType.PAGAR.totalAmount)}</TableCell>
                          <TableCell className="text-right text-emerald-600">{formatCurrency(row.byType.RECEBER.totalAmount)}</TableCell>
                          <TableCell className="text-right text-zinc-500">{formatCurrency(row.totals.discount)}</TableCell>
                          <TableCell className="text-right text-zinc-500">{formatCurrency(row.totals.interest)}</TableCell>
                          <TableCell className="text-right font-bold">{formatCurrency(row.totals.totalAmount)}</TableCell>
                          <TableCell className="text-center">{row.totals.count}</TableCell>
                        </TableRow>
                      ))}
                      {/* Total row */}
                      {reportOverall && (
                        <TableRow className="bg-zinc-50 dark:bg-zinc-900 font-bold">
                          <TableCell>TOTAL</TableCell>
                          <TableCell className="text-right text-red-600">{formatCurrency(0)}</TableCell>
                          <TableCell className="text-right text-emerald-600">{formatCurrency(0)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(reportOverall.discount)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(reportOverall.interest)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(reportOverall.totalAmount)}</TableCell>
                          <TableCell className="text-center">{reportOverall.count}</TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Category breakdown */}
          {reportData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Detalhamento por Categoria</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Período</TableHead>
                        <TableHead>Categoria</TableHead>
                        <TableHead className="text-right">Valor Bruto</TableHead>
                        <TableHead className="text-right">Desconto</TableHead>
                        <TableHead className="text-right">Juros</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-center">Qtd</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportData.flatMap((row) =>
                        Object.entries(row.categories).map(([cat, data]) => (
                          <TableRow key={`${row.period}-${cat}`}>
                            <TableCell className="text-sm">{row.period}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="text-xs">{cat}</Badge>
                            </TableCell>
                            <TableCell className="text-right">{formatCurrency(data.amount)}</TableCell>
                            <TableCell className="text-right text-zinc-500">{formatCurrency(data.discount)}</TableCell>
                            <TableCell className="text-right text-zinc-500">{formatCurrency(data.interest)}</TableCell>
                            <TableCell className="text-right font-medium">{formatCurrency(data.totalAmount)}</TableCell>
                            <TableCell className="text-center">{data.count}</TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* ============================================= */}
      {/* NEW ENTRY DIALOG */}
      {/* ============================================= */}
      <Dialog open={showEntryDialog} onOpenChange={setShowEntryDialog}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-emerald-600" />
              Novo Título Financeiro
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Tipo *</Label>
              <Select value={entryForm.type} onValueChange={(v) => setEntryForm({ ...entryForm, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PAGAR">
                    <span className="flex items-center gap-2"><ArrowUpRight className="h-4 w-4 text-red-500" /> Conta a Pagar</span>
                  </SelectItem>
                  <SelectItem value="RECEBER">
                    <span className="flex items-center gap-2"><ArrowDownRight className="h-4 w-4 text-emerald-600" /> Conta a Receber</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={entryForm.category} onValueChange={(v) => setEntryForm({ ...entryForm, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ASSINATURA">Assinatura</SelectItem>
                  <SelectItem value="OS">Ordem de Serviço</SelectItem>
                  <SelectItem value="NF">Nota Fiscal</SelectItem>
                  <SelectItem value="OUTROS">Outros</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Descrição *</Label>
              <Input
                placeholder="Descrição do título"
                value={entryForm.description}
                onChange={(e) => setEntryForm({ ...entryForm, description: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Valor (R$) *</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={entryForm.amount}
                  onChange={(e) => setEntryForm({ ...entryForm, amount: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Desconto (R$)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={entryForm.discount}
                  onChange={(e) => setEntryForm({ ...entryForm, discount: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label>Juros (R$)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={entryForm.interest}
                  onChange={(e) => setEntryForm({ ...entryForm, interest: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>

            {/* Total display */}
            <Card className="bg-zinc-50 dark:bg-zinc-900">
              <CardContent className="p-3 flex items-center justify-between">
                <span className="text-sm text-zinc-600">Total</span>
                <span className={`text-lg font-bold ${totalAmount >= 0 ? 'text-zinc-900 dark:text-zinc-100' : 'text-red-600'}`}>
                  {formatCurrency(totalAmount)}
                </span>
              </CardContent>
            </Card>

            <div className="space-y-2">
              <Label>Vencimento *</Label>
              <Input
                type="date"
                value={entryForm.dueDate}
                onChange={(e) => setEntryForm({ ...entryForm, dueDate: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Forma de Pagamento</Label>
              <Select value={entryForm.paymentMethod} onValueChange={(v) => setEntryForm({ ...entryForm, paymentMethod: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="PIX">
                    <span className="flex items-center gap-2"><QrCode className="h-4 w-4" /> PIX</span>
                  </SelectItem>
                  <SelectItem value="CARTAO">
                    <span className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Cartão</span>
                  </SelectItem>
                  <SelectItem value="DINHEIRO">
                    <span className="flex items-center gap-2"><Banknote className="h-4 w-4" /> Dinheiro</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {entryForm.type === 'PAGAR' && (
              <div className="space-y-2">
                <Label>Fornecedor</Label>
                <Select value={entryForm.supplierId} onValueChange={(v) => setEntryForm({ ...entryForm, supplierId: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione o fornecedor" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Nenhum</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.nomeFantasia || s.razaoSocial}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>Referência</Label>
              <Input
                placeholder="Ex: OS 0042, NF 12345"
                value={entryForm.reference}
                onChange={(e) => setEntryForm({ ...entryForm, reference: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEntryDialog(false)}>Cancelar</Button>
            <Button
              onClick={handleSaveEntry}
              disabled={saving || !entryForm.description.trim() || entryForm.amount <= 0 || !entryForm.dueDate}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Criar Título
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================= */}
      {/* PAYMENT DIALOG */}
      {/* ============================================= */}
      <Dialog open={showPayDialog} onOpenChange={setShowPayDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              {payingEntry?.type === 'PAGAR' ? 'Confirmar Pagamento' : 'Confirmar Recebimento'}
            </DialogTitle>
          </DialogHeader>
          {payingEntry && (
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Descrição</span>
                  <span className="font-medium">{payingEntry.description}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Valor</span>
                  <span className={`font-bold text-lg ${payingEntry.type === 'RECEBER' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {formatCurrency(payingEntry.totalAmount)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Vencimento</span>
                  <span>{formatDate(payingEntry.dueDate)}</span>
                </div>
                {payingEntry.discount > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">Desconto</span>
                    <span className="text-emerald-600">-{formatCurrency(payingEntry.discount)}</span>
                  </div>
                )}
                {payingEntry.interest > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-zinc-500">Juros</span>
                    <span className="text-red-600">+{formatCurrency(payingEntry.interest)}</span>
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Forma de Pagamento</Label>
                <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                  <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PIX">
                      <span className="flex items-center gap-2"><QrCode className="h-4 w-4" /> PIX</span>
                    </SelectItem>
                    <SelectItem value="CARTAO">
                      <span className="flex items-center gap-2"><CreditCard className="h-4 w-4" /> Cartão</span>
                    </SelectItem>
                    <SelectItem value="DINHEIRO">
                      <span className="flex items-center gap-2"><Banknote className="h-4 w-4" /> Dinheiro</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPayDialog(false)}>Cancelar</Button>
            <Button onClick={handleConfirmPay} disabled={savingPayment} className="bg-emerald-600 hover:bg-emerald-700">
              {savingPayment && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Confirmar {payingEntry?.type === 'PAGAR' ? 'Pagamento' : 'Recebimento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
