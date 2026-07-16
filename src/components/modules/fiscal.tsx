'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import {
  ShieldCheck,
  FileText,
  AlertTriangle,
  Clock,
  CheckCircle2,
  XCircle,
  Eye,
  Loader2,
  RefreshCw,
  ChevronRight,
  TrendingUp,
  Receipt,
  Truck,
  FileKey2,
  AlertCircle,
  Info,
  Bell,
  BellOff,
  X,
  Send,
  Ban,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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

// =============================================
// TYPES
// =============================================

interface FiscalDashboardData {
  resumo: {
    totalNfeEntrada: number
    totalNfeSaida: number
    totalCte: number
    totalNfse: number
    nfePendentesConferencia: number
    manifestacoesPendentes: number
    certificadoDiasVencimento: number | null
  }
  alertas: FiscalAlerta[]
  obrigacoes: ObrigacaoFiscal[]
  impostos: {
    totalIcms: number
    totalIpi: number
    totalPis: number
    totalCofins: number
    totalIssqn: number
  }
  graficosMensais: Array<{
    mes: string
    nfeEntrada: number
    nfeSaida: number
    nfse: number
    impostos: number
  }>
}

interface FiscalAlerta {
  id: string
  tipo: string
  severidade: string
  titulo: string
  descricao: string
  dados: string | null
  referenciaId: string | null
  referenciaTipo: string | null
  lido: boolean
  resolvido: boolean
  dataVencimento: string | null
  officeId: string
  createdAt: string
  updatedAt: string
}

interface ObrigacaoFiscal {
  nome: string
  competencia: string
  dataVencimento: string
  status: 'PENDENTE' | 'ENTREGUE' | 'ATRASADA'
  tipo: 'SPED_FISCAL' | 'DCTF' | 'GIA' | 'DIRF' | 'DAS' | 'ISSQN'
}

interface NfseItem {
  id: string
  numero: string
  competencia: string | null
  itemListaServico: string | null
  discriminacao: string
  valorServicos: number
  valorIssqn: number
  status: string
  clienteNome: string | null
  clienteCpfCnpj: string | null
  dataEmissao: string
  createdAt: string
  client: { id: string; name: string; cpfCnpj: string | null } | null
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

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

function formatMes(mes: string): string {
  const [year, month] = mes.split('-')
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
  return `${months[parseInt(month) - 1]}/${year.slice(2)}`
}

const SEVERIDADE_CONFIG: Record<string, { label: string; className: string; icon: typeof AlertTriangle; color: string }> = {
  CRITICO: { label: 'Crítico', className: 'bg-red-100 text-red-800 hover:bg-red-100', icon: XCircle, color: 'text-red-600' },
  AVISO: { label: 'Aviso', className: 'bg-amber-100 text-amber-800 hover:bg-amber-100', icon: AlertTriangle, color: 'text-amber-600' },
  INFO: { label: 'Info', className: 'bg-sky-100 text-sky-800 hover:bg-sky-100', icon: Info, color: 'text-sky-600' },
}

const ALERTA_TIPO_LABELS: Record<string, string> = {
  CERTIFICADO_VENCENDO: 'Certificado',
  OBRIGACAO_VENCENDO: 'Obrigação',
  NF_PENDENTE_CONFERENCIA: 'NF Pendente',
  SPED_PENDENTE: 'SPED',
  MANIFESTACAO_PENDENTE: 'Manifestação',
  CTE_PENDENTE: 'CT-e',
  NFS_EMITIDA_SEM_ENVIO: 'NFS-e Envio',
  DIVERGENCIA_FISCAL: 'Divergência',
}

const OBRIGACAO_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  ATRASADA: { label: 'Atrasada', className: 'bg-red-100 text-red-800' },
  PENDENTE: { label: 'Pendente', className: 'bg-amber-100 text-amber-800' },
  ENTREGUE: { label: 'Entregue', className: 'bg-emerald-100 text-emerald-800' },
}

const NFS_STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  EMITIDA: { label: 'Emitida', className: 'bg-emerald-100 text-emerald-800' },
  CANCELADA: { label: 'Cancelada', className: 'bg-red-100 text-red-800' },
  SUBSTITUIDA: { label: 'Substituída', className: 'bg-sky-100 text-sky-800' },
}

// =============================================
// MAIN COMPONENT
// =============================================

export function FiscalModule() {
  const { office } = useAuthStore()
  const officeId = office?.id

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [dashboardData, setDashboardData] = useState<FiscalDashboardData | null>(null)
  const [activeTab, setActiveTab] = useState('resumo')

  // NFS-e state
  const [nfseList, setNfseList] = useState<NfseItem[]>([])
  const [nfseLoading, setNfseLoading] = useState(false)
  const [selectedNfse, setSelectedNfse] = useState<NfseItem | null>(null)
  const [nfseDetailOpen, setNfseDetailOpen] = useState(false)
  const [nfseDetailLoading, setNfseDetailLoading] = useState(false)
  const [nfseDetail, setNfseDetail] = useState<Record<string, unknown> | null>(null)

  const fetchDashboard = useCallback(async () => {
    if (!officeId) return
    setRefreshing(true)
    try {
      const res = await apiFetch(`/api/fiscal/dashboard?officeId=${officeId}&refreshAlerts=true`)
      if (res.success && res.data) {
        setDashboardData(res.data as FiscalDashboardData)
      }
    } catch (error) {
      console.error('Error fetching fiscal dashboard:', error)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [officeId])

  const fetchNfseList = useCallback(async () => {
    if (!officeId) return
    setNfseLoading(true)
    try {
      const res = await apiFetch(`/api/nfse?officeId=${officeId}`)
      if (res.success && res.data) {
        setNfseList(res.data as NfseItem[])
      }
    } catch (error) {
      console.error('Error fetching NFS-e:', error)
    } finally {
      setNfseLoading(false)
    }
  }, [officeId])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  useEffect(() => {
    if (activeTab === 'nfse') fetchNfseList()
  }, [activeTab, fetchNfseList])

  // Mark alert as read
  const handleMarkAlertRead = async (alertaId: string) => {
    if (!officeId) return
    try {
      await apiFetch(`/api/fiscal/alertas/${alertaId}`, {
        method: 'PUT',
        body: JSON.stringify({ officeId, acao: 'ler' }),
      })
      fetchDashboard()
    } catch (error) {
      console.error('Error marking alert as read:', error)
    }
  }

  // Resolve alert
  const handleResolveAlert = async (alertaId: string) => {
    if (!officeId) return
    try {
      await apiFetch(`/api/fiscal/alertas/${alertaId}`, {
        method: 'PUT',
        body: JSON.stringify({ officeId, acao: 'resolver' }),
      })
      fetchDashboard()
    } catch (error) {
      console.error('Error resolving alert:', error)
    }
  }

  // Mark all alerts as read
  const handleMarkAllRead = async () => {
    if (!officeId) return
    try {
      await apiFetch(`/api/fiscal/alertas/${officeId ? `some-id` : ''}`, {
        method: 'PUT',
        body: JSON.stringify({ officeId, acao: 'ler_todos' }),
      })
      fetchDashboard()
    } catch (error) {
      console.error('Error marking all alerts as read:', error)
    }
  }

  // View NFS-e detail
  const handleViewNfse = async (nfse: NfseItem) => {
    if (!officeId) return
    setSelectedNfse(nfse)
    setNfseDetailOpen(true)
    setNfseDetailLoading(true)
    try {
      const res = await apiFetch(`/api/nfse/${nfse.id}?officeId=${officeId}`)
      if (res.success && res.data) {
        setNfseDetail(res.data as Record<string, unknown>)
      }
    } catch (error) {
      console.error('Error fetching NFS-e detail:', error)
    } finally {
      setNfseDetailLoading(false)
    }
  }

  // Cancel NFS-e
  const handleCancelNfse = async (nfseId: string) => {
    if (!officeId) return
    try {
      const res = await apiFetch(`/api/nfse/${nfseId}?officeId=${officeId}&motivoCancelamento=Cancelamento+solicitado+pelo+usuario`, {
        method: 'DELETE',
      })
      if (res.success) {
        setNfseDetailOpen(false)
        fetchNfseList()
        fetchDashboard()
      }
    } catch (error) {
      console.error('Error canceling NFS-e:', error)
    }
  }

  const data = dashboardData

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold text-zinc-900 tracking-tight flex items-center gap-2">
              <ShieldCheck className="w-7 h-7 text-emerald-600" />
              Dashboard Fiscal
            </h1>
            <p className="text-zinc-500 text-sm mt-0.5">
              Visão geral fiscal e conformidade tributária
            </p>
          </div>
          <Button
            onClick={fetchDashboard}
            variant="outline"
            size="sm"
            disabled={refreshing}
            className="w-fit border-emerald-200 text-emerald-700 hover:bg-emerald-50 gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {loading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="border-zinc-200/60">
                <CardContent className="p-4">
                  <Skeleton className="h-4 w-16 mb-2" />
                  <Skeleton className="h-7 w-12" />
                </CardContent>
              </Card>
            ))
          ) : (
            <>
              <Card className="border-zinc-200/60 hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <FileText className="w-4 h-4 text-emerald-600" />
                    <p className="text-xs text-zinc-500 font-medium">NF-e Entrada</p>
                  </div>
                  <p className="text-2xl font-bold text-zinc-900">{data?.resumo.totalNfeEntrada ?? 0}</p>
                </CardContent>
              </Card>
              <Card className="border-zinc-200/60 hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Send className="w-4 h-4 text-sky-600" />
                    <p className="text-xs text-zinc-500 font-medium">NF-e Saída</p>
                  </div>
                  <p className="text-2xl font-bold text-zinc-900">{data?.resumo.totalNfeSaida ?? 0}</p>
                </CardContent>
              </Card>
              <Card className="border-zinc-200/60 hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Receipt className="w-4 h-4 text-amber-600" />
                    <p className="text-xs text-zinc-500 font-medium">NFS-e</p>
                  </div>
                  <p className="text-2xl font-bold text-zinc-900">{data?.resumo.totalNfse ?? 0}</p>
                </CardContent>
              </Card>
              <Card className="border-zinc-200/60 hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <Truck className="w-4 h-4 text-purple-600" />
                    <p className="text-xs text-zinc-500 font-medium">CT-e</p>
                  </div>
                  <p className="text-2xl font-bold text-zinc-900">{data?.resumo.totalCte ?? 0}</p>
                </CardContent>
              </Card>
              <Card className="border-zinc-200/60 hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle className="w-4 h-4 text-orange-600" />
                    <p className="text-xs text-zinc-500 font-medium">Pendentes</p>
                  </div>
                  <p className="text-2xl font-bold text-zinc-900">{data?.resumo.nfePendentesConferencia ?? 0}</p>
                </CardContent>
              </Card>
              <Card className={`border-zinc-200/60 hover:shadow-md transition-shadow ${(data?.resumo.certificadoDiasVencimento ?? 999) <= 30 ? 'ring-2 ring-amber-300' : ''}`}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <FileKey2 className="w-4 h-4 text-zinc-600" />
                    <p className="text-xs text-zinc-500 font-medium">Certificado</p>
                  </div>
                  <p className="text-2xl font-bold text-zinc-900">
                    {data?.resumo.certificadoDiasVencimento !== null && data?.resumo.certificadoDiasVencimento !== undefined
                      ? `${data.resumo.certificadoDiasVencimento}d`
                      : '—'}
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="resumo" className="gap-2">
              <TrendingUp className="w-4 h-4" /> Resumo
            </TabsTrigger>
            <TabsTrigger value="alertas" className="gap-2 relative">
              <Bell className="w-4 h-4" /> Alertas
              {data && data.alertas.filter(a => !a.lido).length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-bold">
                  {data.alertas.filter(a => !a.lido).length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="obrigacoes" className="gap-2">
              <Clock className="w-4 h-4" /> Obrigações
            </TabsTrigger>
            <TabsTrigger value="nfse" className="gap-2">
              <Receipt className="w-4 h-4" /> NFS-e
            </TabsTrigger>
          </TabsList>

          {/* ===== TAB: Resumo Fiscal ===== */}
          <TabsContent value="resumo" className="space-y-6 mt-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Chart - Monthly Documents */}
              <Card className="border-zinc-200/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold text-zinc-900">
                    Documentos Fiscais por Mês
                  </CardTitle>
                  <CardDescription className="text-xs text-zinc-400">
                    Últimos 12 meses
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {loading ? (
                    <div className="h-[260px] flex items-center justify-center">
                      <Skeleton className="h-[240px] w-full" />
                    </div>
                  ) : !data?.graficosMensais.length ? (
                    <div className="h-[260px] flex flex-col items-center justify-center text-zinc-400">
                      <FileText className="w-10 h-10 mb-2 opacity-40" />
                      <p className="text-sm">Sem dados no período</p>
                    </div>
                  ) : (
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={data.graficosMensais} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                          <XAxis
                            dataKey="mes"
                            tick={{ fontSize: 10, fill: '#71717a' }}
                            axisLine={{ stroke: '#e4e4e7' }}
                            tickLine={false}
                            tickFormatter={formatMes}
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
                          <Bar dataKey="nfeEntrada" name="NF-e Entrada" fill="#059669" radius={[4, 4, 0, 0]} maxBarSize={24} />
                          <Bar dataKey="nfeSaida" name="NF-e Saída" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={24} />
                          <Bar dataKey="nfse" name="NFS-e" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={24} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Chart - Monthly Taxes */}
              <Card className="border-zinc-200/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base font-semibold text-zinc-900">
                    Impostos por Mês
                  </CardTitle>
                  <CardDescription className="text-xs text-zinc-400">
                    Últimos 12 meses (R$)
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  {loading ? (
                    <div className="h-[260px] flex items-center justify-center">
                      <Skeleton className="h-[240px] w-full" />
                    </div>
                  ) : !data?.graficosMensais.length ? (
                    <div className="h-[260px] flex flex-col items-center justify-center text-zinc-400">
                      <TrendingUp className="w-10 h-10 mb-2 opacity-40" />
                      <p className="text-sm">Sem dados no período</p>
                    </div>
                  ) : (
                    <div className="h-[260px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={data.graficosMensais} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" vertical={false} />
                          <XAxis
                            dataKey="mes"
                            tick={{ fontSize: 10, fill: '#71717a' }}
                            axisLine={{ stroke: '#e4e4e7' }}
                            tickLine={false}
                            tickFormatter={formatMes}
                          />
                          <YAxis
                            tick={{ fontSize: 11, fill: '#71717a' }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(val: number) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : String(val)}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#fff',
                              border: '1px solid #e4e4e7',
                              borderRadius: '8px',
                              fontSize: '12px',
                              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
                            }}
                            formatter={(value: number) => [formatCurrency(value), 'Impostos']}
                          />
                          <Line
                            type="monotone"
                            dataKey="impostos"
                            name="Impostos"
                            stroke="#ef4444"
                            strokeWidth={2}
                            dot={{ r: 3, fill: '#ef4444' }}
                            activeDot={{ r: 5, strokeWidth: 0 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Tax Summary */}
            <Card className="border-zinc-200/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-semibold text-zinc-900">
                  Resumo de Impostos (Mês Atual)
                </CardTitle>
                <CardDescription className="text-xs text-zinc-400">
                  Total de impostos apurados no mês
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {loading ? (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="p-4 rounded-lg bg-zinc-50/50">
                        <Skeleton className="h-3 w-16 mb-2" />
                        <Skeleton className="h-6 w-24" />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                    <div className="p-4 rounded-lg bg-emerald-50/70">
                      <p className="text-xs font-medium text-zinc-500">ICMS</p>
                      <p className="text-lg font-bold text-emerald-700 mt-1">{formatCurrency(data?.impostos.totalIcms || 0)}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-sky-50/70">
                      <p className="text-xs font-medium text-zinc-500">IPI</p>
                      <p className="text-lg font-bold text-sky-700 mt-1">{formatCurrency(data?.impostos.totalIpi || 0)}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-amber-50/70">
                      <p className="text-xs font-medium text-zinc-500">PIS</p>
                      <p className="text-lg font-bold text-amber-700 mt-1">{formatCurrency(data?.impostos.totalPis || 0)}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-purple-50/70">
                      <p className="text-xs font-medium text-zinc-500">COFINS</p>
                      <p className="text-lg font-bold text-purple-700 mt-1">{formatCurrency(data?.impostos.totalCofins || 0)}</p>
                    </div>
                    <div className="p-4 rounded-lg bg-orange-50/70">
                      <p className="text-xs font-medium text-zinc-500">ISSQN</p>
                      <p className="text-lg font-bold text-orange-700 mt-1">{formatCurrency(data?.impostos.totalIssqn || 0)}</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ===== TAB: Alertas ===== */}
          <TabsContent value="alertas" className="space-y-4 mt-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">Alertas de Conformidade</h2>
                <p className="text-sm text-zinc-500">Avisos e pendências fiscais que precisam de atenção</p>
              </div>
              {data && data.alertas.filter(a => !a.lido).length > 0 && (
                <Button variant="outline" size="sm" onClick={handleMarkAllRead} className="gap-2">
                  <BellOff className="w-4 h-4" /> Marcar todos como lidos
                </Button>
              )}
            </div>

            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Card key={i} className="border-zinc-200/60">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-48" />
                          <Skeleton className="h-3 w-full" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : !data?.alertas.length ? (
              <Card className="border-zinc-200/60">
                <CardContent className="py-12 flex flex-col items-center justify-center text-zinc-400">
                  <CheckCircle2 className="w-12 h-12 mb-3 text-emerald-300" />
                  <p className="font-medium text-zinc-600">Tudo em conformidade!</p>
                  <p className="text-sm">Nenhum alerta fiscal pendente no momento.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto">
                {data.alertas.map((alerta) => {
                  const config = SEVERIDADE_CONFIG[alerta.severidade] || SEVERIDADE_CONFIG.AVISO
                  const Icon = config.icon
                  return (
                    <Card
                      key={alerta.id}
                      className={`border-zinc-200/60 transition-all ${!alerta.lido ? 'ring-1 ring-amber-200' : 'opacity-75'}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                            alerta.severidade === 'CRITICO' ? 'bg-red-50' :
                            alerta.severidade === 'AVISO' ? 'bg-amber-50' : 'bg-sky-50'
                          }`}>
                            <Icon className={`w-5 h-5 ${config.color}`} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-semibold text-zinc-800">{alerta.titulo}</p>
                              <Badge variant="secondary" className={config.className}>
                                {config.label}
                              </Badge>
                              <Badge variant="outline" className="text-[10px]">
                                {ALERTA_TIPO_LABELS[alerta.tipo] || alerta.tipo}
                              </Badge>
                            </div>
                            <p className="text-sm text-zinc-600 mt-1">{alerta.descricao}</p>
                            {alerta.dataVencimento && (
                              <p className="text-xs text-zinc-400 mt-1">
                                Vencimento: {formatDate(alerta.dataVencimento)}
                              </p>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {!alerta.lido && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleMarkAlertRead(alerta.id)}
                                className="h-8 w-8 p-0"
                                title="Marcar como lido"
                              >
                                <Eye className="w-4 h-4 text-zinc-400" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleResolveAlert(alerta.id)}
                              className="h-8 w-8 p-0"
                              title="Resolver alerta"
                            >
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>

          {/* ===== TAB: Obrigações ===== */}
          <TabsContent value="obrigacoes" className="space-y-4 mt-6">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Obrigações Fiscais</h2>
              <p className="text-sm text-zinc-500">Calendário de obrigações acessórias e tributárias</p>
            </div>

            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="p-4 rounded-lg bg-zinc-50/50">
                    <Skeleton className="h-4 w-32 mb-2" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                ))}
              </div>
            ) : !data?.obrigacoes.length ? (
              <Card className="border-zinc-200/60">
                <CardContent className="py-12 flex flex-col items-center justify-center text-zinc-400">
                  <Clock className="w-12 h-12 mb-3 opacity-40" />
                  <p className="text-sm">Nenhuma obrigação fiscal encontrada</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-zinc-200/60">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Obrigação</TableHead>
                          <TableHead>Competência</TableHead>
                          <TableHead>Vencimento</TableHead>
                          <TableHead>Tipo</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.obrigacoes.map((obr, i) => {
                          const statusConf = OBRIGACAO_STATUS_CONFIG[obr.status] || OBRIGACAO_STATUS_CONFIG.PENDENTE
                          return (
                            <TableRow key={`${obr.tipo}-${obr.competencia}-${i}`}>
                              <TableCell className="font-medium text-sm">{obr.nome}</TableCell>
                              <TableCell className="text-sm">{obr.competencia}</TableCell>
                              <TableCell className="text-sm">{formatDate(obr.dataVencimento)}</TableCell>
                              <TableCell>
                                <Badge variant="outline" className="text-[10px]">{obr.tipo}</Badge>
                              </TableCell>
                              <TableCell>
                                <Badge variant="secondary" className={statusConf.className}>
                                  {statusConf.label}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ===== TAB: NFS-e ===== */}
          <TabsContent value="nfse" className="space-y-4 mt-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-zinc-900">Notas Fiscais de Serviço (NFS-e)</h2>
                <p className="text-sm text-zinc-500">Notas fiscais de serviço eletrônicas emitidas</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchNfseList}
                disabled={nfseLoading}
                className="gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${nfseLoading ? 'animate-spin' : ''}`} />
                Atualizar
              </Button>
            </div>

            {nfseLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Card key={i} className="border-zinc-200/60">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-10 w-10 rounded-lg" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-48" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                        <Skeleton className="h-6 w-16" />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : !nfseList.length ? (
              <Card className="border-zinc-200/60">
                <CardContent className="py-12 flex flex-col items-center justify-center text-zinc-400">
                  <Receipt className="w-12 h-12 mb-3 opacity-40" />
                  <p className="font-medium text-zinc-600">Nenhuma NFS-e emitida</p>
                  <p className="text-sm">As NFS-e serão geradas automaticamente a partir de Ordens de Serviço pagas.</p>
                </CardContent>
              </Card>
            ) : (
              <Card className="border-zinc-200/60">
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Número</TableHead>
                          <TableHead>Cliente</TableHead>
                          <TableHead>Serviço</TableHead>
                          <TableHead>Valor</TableHead>
                          <TableHead>ISSQN</TableHead>
                          <TableHead>Competência</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {nfseList.map((nfse) => {
                          const statusConf = NFS_STATUS_CONFIG[nfse.status] || NFS_STATUS_CONFIG.EMITIDA
                          return (
                            <TableRow key={nfse.id}>
                              <TableCell className="font-mono font-medium text-sm">{nfse.numero}</TableCell>
                              <TableCell className="text-sm">
                                <div>
                                  <p className="font-medium">{nfse.clienteNome || nfse.client?.name || '—'}</p>
                                  {nfse.clienteCpfCnpj && (
                                    <p className="text-xs text-zinc-400">{nfse.clienteCpfCnpj}</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="text-sm max-w-[200px] truncate" title={nfse.discriminacao}>
                                {nfse.itemListaServico || '—'}
                              </TableCell>
                              <TableCell className="text-sm font-medium">{formatCurrency(nfse.valorServicos)}</TableCell>
                              <TableCell className="text-sm">{formatCurrency(nfse.valorIssqn)}</TableCell>
                              <TableCell className="text-sm">{nfse.competencia || '—'}</TableCell>
                              <TableCell>
                                <Badge variant="secondary" className={statusConf.className}>
                                  {statusConf.label}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => handleViewNfse(nfse)}
                                  className="gap-1"
                                >
                                  <Eye className="w-4 h-4" /> Ver
                                </Button>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* NFS-e Detail Dialog */}
      <Dialog open={nfseDetailOpen} onOpenChange={setNfseDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5 text-emerald-600" />
              NFS-e {selectedNfse?.numero || ''}
            </DialogTitle>
          </DialogHeader>
          {nfseDetailLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              <span className="ml-2 text-zinc-500">Carregando...</span>
            </div>
          ) : nfseDetail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-zinc-500">Número</p>
                  <p className="font-mono font-medium">{String(nfseDetail.numero || '')}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Código Verificação</p>
                  <p className="font-mono font-medium">{String(nfseDetail.codigoVerificacao || '—')}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Competência</p>
                  <p className="font-medium">{String(nfseDetail.competencia || '—')}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Data Emissão</p>
                  <p className="font-medium">{formatDate(String(nfseDetail.dataEmissao))}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Tipo Tributação</p>
                  <p className="font-medium">{String(nfseDetail.tipoTributacao || '—')}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Item Lista Serviço</p>
                  <p className="font-medium">{String(nfseDetail.itemListaServico || '—')}</p>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-zinc-500 text-sm">Discriminação</p>
                <p className="text-sm mt-1 whitespace-pre-wrap bg-zinc-50 rounded-lg p-3">
                  {String(nfseDetail.discriminacao || '—')}
                </p>
              </div>

              <Separator />

              <div>
                <p className="text-sm font-medium text-zinc-700 mb-2">Cliente</p>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-zinc-500">Nome</p>
                    <p className="font-medium">{String(nfseDetail.clienteNome || '—')}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">CPF/CNPJ</p>
                    <p className="font-mono">{String(nfseDetail.clienteCpfCnpj || '—')}</p>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-sm font-medium text-zinc-700 mb-2">Valores</p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  <div className="p-3 rounded-lg bg-emerald-50/70">
                    <p className="text-zinc-500 text-xs">Valor Serviços</p>
                    <p className="font-bold text-emerald-700">{formatCurrency(Number(nfseDetail.valorServicos) || 0)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-red-50/70">
                    <p className="text-zinc-500 text-xs">Deduções</p>
                    <p className="font-bold text-red-700">{formatCurrency(Number(nfseDetail.valorDeducoes) || 0)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-amber-50/70">
                    <p className="text-zinc-500 text-xs">Base Cálculo</p>
                    <p className="font-bold text-amber-700">{formatCurrency(Number(nfseDetail.baseCalculo) || 0)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-orange-50/70">
                    <p className="text-zinc-500 text-xs">ISSQN ({String(nfseDetail.aliqIssqn || 0)}%)</p>
                    <p className="font-bold text-orange-700">{formatCurrency(Number(nfseDetail.valorIssqn) || 0)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-sky-50/70">
                    <p className="text-zinc-500 text-xs">PIS</p>
                    <p className="font-bold text-sky-700">{formatCurrency(Number(nfseDetail.valorPis) || 0)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-purple-50/70">
                    <p className="text-zinc-500 text-xs">COFINS</p>
                    <p className="font-bold text-purple-700">{formatCurrency(Number(nfseDetail.valorCofins) || 0)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-zinc-50">
                    <p className="text-zinc-500 text-xs">IR</p>
                    <p className="font-bold">{formatCurrency(Number(nfseDetail.valorIr) || 0)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-zinc-50">
                    <p className="text-zinc-500 text-xs">CSLL</p>
                    <p className="font-bold">{formatCurrency(Number(nfseDetail.valorCsll) || 0)}</p>
                  </div>
                  <div className="p-3 rounded-lg bg-zinc-50">
                    <p className="text-zinc-500 text-xs">INSS</p>
                    <p className="font-bold">{formatCurrency(Number(nfseDetail.valorInss) || 0)}</p>
                  </div>
                </div>
              </div>

              {Boolean(nfseDetail.motivoCancelamento) && (
                <>
                  <Separator />
                  <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                    <p className="text-sm font-medium text-red-800">Motivo de Cancelamento</p>
                    <p className="text-sm text-red-700 mt-1">{String(nfseDetail.motivoCancelamento)}</p>
                  </div>
                </>
              )}

              {String(nfseDetail.status) === 'EMITIDA' && (
                <DialogFooter>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleCancelNfse(String(nfseDetail.id))}
                    className="gap-2"
                  >
                    <Ban className="w-4 h-4" /> Cancelar NFS-e
                  </Button>
                </DialogFooter>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-zinc-500">Nenhum dado encontrado</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
