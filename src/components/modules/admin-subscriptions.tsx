'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Crown,
  Zap,
  Rocket,
  Star,
  Loader2,
  Search,
  Users,
  DollarSign,
  AlertTriangle,
  TrendingUp,
  CreditCard,
  Mail,
  Phone,
  Building2,
  Calendar,
  Hash,
  ArrowLeft,
  ChevronRight,
  User,
  MapPin,
  XCircle,
  CheckCircle2,
  Clock,
  Shield,
} from 'lucide-react'

// =============================================
// TYPES
// =============================================
interface PlanDetails {
  maxOS: number
  maxClients: number
  maxParts: number
  aiAccess: boolean
  whatsapp: boolean
  price: number
  label: string
}

interface SubscriberData {
  id: string
  plan: string
  status: string
  subscriptionCode: string | null
  startDate: string
  endDate: string | null
  trialEndDate: string | null
  monthlyPrice: number
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  createdAt: string
  planDetails: PlanDetails
  ownerName: string
  ownerEmail: string
  office: {
    id: string
    name: string
    cnpj: string
    email: string
    phone: string | null
    address: string | null
    city: string | null
    state: string | null
    active: boolean
    createdAt: string
    users: { id: string; name: string; email: string; role: string }[]
  }
}

interface Stats {
  totalSubscribers: number
  activeSubscribers: number
  payingSubscribers: number
  overdueSubscribers: number
  cancelledSubscribers: number
  trialSubscribers: number
  mrr: number
  revenueByPlan: { plan: string; label: string; count: number; revenue: number }[]
  countByPlan: { plan: string; label: string; count: number }[]
  statusDistribution: { status: string; label: string; count: number }[]
}

// =============================================
// HELPERS
// =============================================
function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatDateTime(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const PLAN_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  FREE: { label: 'Free', color: 'bg-zinc-100 text-zinc-700 border-zinc-200', icon: Zap },
  PRO: { label: 'Pro', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Rocket },
  PRO_PLUS: { label: 'Pro+', color: 'bg-purple-100 text-purple-700 border-purple-200', icon: Crown },
  PREMIUM: { label: 'Premium', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: Star },
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  ATIVA: { label: 'Ativa', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  TRIAL: { label: 'Trial', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Clock },
  INADIMPLENTE: { label: 'Inadimplente', color: 'bg-red-100 text-red-700 border-red-200', icon: AlertTriangle },
  CANCELADA: { label: 'Cancelada', color: 'bg-zinc-100 text-zinc-500 border-zinc-200', icon: XCircle },
}


// =============================================
// MAIN COMPONENT
// =============================================
export function AdminSubscriptionsModule() {
  const { user } = useAuthStore()
  const [subscribers, setSubscribers] = useState<SubscriberData[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterPlan, setFilterPlan] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [selectedSubscriber, setSelectedSubscriber] = useState<SubscriberData | null>(null)

  if (user?.role !== 'ADMIN' && user?.role !== 'OWNER') {
    return (
      <div className="p-12 text-center text-zinc-500">
        <Shield className="w-12 h-12 mx-auto text-red-500 mb-3" />
        <h2 className="text-lg font-bold text-zinc-800">Acesso Restrito</h2>
        <p className="text-sm text-zinc-600 mt-1">
          Apenas administradores ou proprietários do sistema têm acesso a esta área.
        </p>
      </div>
    )
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (filterPlan) params.set('plan', filterPlan)
      if (filterStatus) params.set('status', filterStatus)

      const res = await apiFetch(`/api/admin/subscriptions?${params.toString()}`)
      if (res.success) {
        setSubscribers(res.data)
        setStats(res.stats)
      }
    } catch (err) {
      console.error('Error fetching admin subscriptions:', err)
    } finally {
      setLoading(false)
    }
  }, [search, filterPlan, filterStatus])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // =============================================
  // SUBSCRIBER DETAIL VIEW
  // =============================================
  if (selectedSubscriber) {
    const sub = selectedSubscriber
    const planCfg = PLAN_CONFIG[sub.plan] || PLAN_CONFIG.FREE
    const statusCfg = STATUS_CONFIG[sub.status] || STATUS_CONFIG.ATIVA
    const PlanIcon = planCfg.icon
    const owner = sub.office?.users?.[0]

    return (
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => setSelectedSubscriber(null)} className="gap-1">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Button>
        </div>

        {/* Header */}
        <Card className="border-zinc-200/60">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
                  sub.plan === 'PREMIUM' ? 'bg-amber-100' :
                  sub.plan === 'PRO_PLUS' ? 'bg-purple-100' :
                  sub.plan === 'PRO' ? 'bg-blue-100' : 'bg-zinc-100'
                }`}>
                  <PlanIcon className={`w-7 h-7 ${
                    sub.plan === 'PREMIUM' ? 'text-amber-600' :
                    sub.plan === 'PRO_PLUS' ? 'text-purple-600' :
                    sub.plan === 'PRO' ? 'text-blue-600' : 'text-zinc-600'
                  }`} />
                </div>
                <div>
                  <CardTitle className="text-xl">{sub.office.name}</CardTitle>
                  <CardDescription className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className={planCfg.color}>
                      {planCfg.label}
                    </Badge>
                    <Badge variant="outline" className={statusCfg.color}>
                      {statusCfg.label}
                    </Badge>
                  </CardDescription>
                </div>
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-emerald-700">{formatCurrency(sub.monthlyPrice)}</p>
                <p className="text-xs text-zinc-500">valor mensal</p>
              </div>
            </div>
          </CardHeader>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Subscription Code */}
          <Card className="border-zinc-200/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-2">
                <Hash className="w-4 h-4" /> Código da Assinatura
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-zinc-50 rounded-lg px-4 py-3 font-mono text-lg font-bold text-zinc-900 tracking-wider">
                {sub.subscriptionCode || 'N/A'}
              </div>
            </CardContent>
          </Card>

          {/* Billing Period */}
          <Card className="border-zinc-200/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-2">
                <Calendar className="w-4 h-4" /> Período de Cobrança
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-medium text-zinc-900">{formatDate(sub.currentPeriodStart)} — {formatDate(sub.currentPeriodEnd)}</p>
              <p className="text-sm text-zinc-500 mt-1">Início: {formatDate(sub.startDate)}</p>
              {sub.trialEndDate && (
                <p className="text-sm text-blue-600 mt-1">Trial até: {formatDate(sub.trialEndDate)}</p>
              )}
            </CardContent>
          </Card>

          {/* Contact Info */}
          <Card className="border-zinc-200/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-2">
                <Mail className="w-4 h-4" /> Contato do Assinante
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm text-zinc-500">Responsável</p>
                  <p className="font-medium text-zinc-900">{owner?.name || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-zinc-500">E-mail</p>
                  <p className="font-medium text-zinc-900">{owner?.email || sub.office.email || '—'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-50 flex items-center justify-center shrink-0">
                  <Phone className="w-4 h-4 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-zinc-500">Telefone</p>
                  <p className="font-medium text-zinc-900">{sub.office.phone || '—'}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Office Info */}
          <Card className="border-zinc-200/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-2">
                <Building2 className="w-4 h-4" /> Dados da Oficina
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <Hash className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="text-zinc-500">CNPJ:</span>
                <span className="font-medium text-zinc-900">{sub.office.cnpj}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Mail className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="text-zinc-500">Email:</span>
                <span className="font-medium text-zinc-900">{sub.office.email}</span>
              </div>
              {(sub.office.city || sub.office.state) && (
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span className="font-medium text-zinc-900">
                    {[sub.office.city, sub.office.state].filter(Boolean).join(' - ')}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="text-zinc-500">Cadastro:</span>
                <span className="font-medium text-zinc-900">{formatDateTime(sub.office.createdAt)}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <CreditCard className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                <span className="text-zinc-500">Assinatura:</span>
                <span className="font-medium text-zinc-900">{formatDateTime(sub.createdAt)}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    )
  }

  // =============================================
  // MAIN DASHBOARD VIEW
  // =============================================
  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
          <Crown className="w-6 h-6 text-amber-500" />
          Painel Administrativo — Assinaturas
        </h1>
        <p className="text-sm text-zinc-500 mt-1">Gerencie todos os assinantes, planos e receitas do KiteOS</p>
      </div>

      {/* KPI Cards */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Card className="border-zinc-200/60">
            <CardContent className="pt-4 pb-3 text-center">
              <Users className="w-5 h-5 text-zinc-500 mx-auto mb-1" />
              <p className="text-2xl font-bold text-zinc-900">{stats.totalSubscribers}</p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Total</p>
            </CardContent>
          </Card>
          <Card className="border-emerald-200/60 bg-emerald-50/30">
            <CardContent className="pt-4 pb-3 text-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mx-auto mb-1" />
              <p className="text-2xl font-bold text-emerald-700">{stats.activeSubscribers}</p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Ativas</p>
            </CardContent>
          </Card>
          <Card className="border-blue-200/60 bg-blue-50/30">
            <CardContent className="pt-4 pb-3 text-center">
              <CreditCard className="w-5 h-5 text-blue-600 mx-auto mb-1" />
              <p className="text-2xl font-bold text-blue-700">{stats.payingSubscribers}</p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Pagantes</p>
            </CardContent>
          </Card>
          <Card className="border-amber-200/60 bg-amber-50/30">
            <CardContent className="pt-4 pb-3 text-center">
              <Clock className="w-5 h-5 text-amber-600 mx-auto mb-1" />
              <p className="text-2xl font-bold text-amber-700">{stats.trialSubscribers}</p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Trial</p>
            </CardContent>
          </Card>
          <Card className="border-red-200/60 bg-red-50/30">
            <CardContent className="pt-4 pb-3 text-center">
              <AlertTriangle className="w-5 h-5 text-red-600 mx-auto mb-1" />
              <p className="text-2xl font-bold text-red-700">{stats.overdueSubscribers}</p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">Inadimplentes</p>
            </CardContent>
          </Card>
          <Card className="border-emerald-200/60 bg-emerald-50/30">
            <CardContent className="pt-4 pb-3 text-center">
              <DollarSign className="w-5 h-5 text-emerald-600 mx-auto mb-1" />
              <p className="text-xl font-bold text-emerald-700">{formatCurrency(stats.mrr)}</p>
              <p className="text-[10px] text-zinc-500 uppercase tracking-wide">MRR</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Revenue by Plan */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-zinc-200/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> Receita por Plano
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {stats.revenueByPlan.filter(r => r.count > 0).map(rp => {
                const planCfg = PLAN_CONFIG[rp.plan]
                const PlanIcon = planCfg?.icon || Zap
                const pct = stats.mrr > 0 ? (rp.revenue / stats.mrr) * 100 : 0
                return (
                  <div key={rp.plan} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <PlanIcon className="w-4 h-4 text-zinc-500" />
                        <span className="font-medium text-zinc-900">{rp.label}</span>
                        <span className="text-zinc-400">({rp.count})</span>
                      </div>
                      <span className="font-bold text-emerald-700">{formatCurrency(rp.revenue)}</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-zinc-100 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
              {stats.mrr === 0 && (
                <p className="text-sm text-zinc-400 italic">Nenhuma receita registrada</p>
              )}
            </CardContent>
          </Card>

          <Card className="border-zinc-200/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide flex items-center gap-2">
                <Users className="w-4 h-4" /> Distribuição por Status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {stats.statusDistribution.map(sd => {
                const statusCfg = STATUS_CONFIG[sd.status]
                const StatusIcon = statusCfg?.icon || CheckCircle2
                const pct = stats.totalSubscribers > 0 ? (sd.count / stats.totalSubscribers) * 100 : 0
                return (
                  <div key={sd.status} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <StatusIcon className="w-4 h-4 text-zinc-500" />
                        <span className="font-medium text-zinc-900">{sd.label}</span>
                        <span className="text-zinc-400">({sd.count})</span>
                      </div>
                      <span className="text-zinc-600">{pct.toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-zinc-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          sd.status === 'ATIVA' ? 'bg-emerald-500' :
                          sd.status === 'TRIAL' ? 'bg-blue-500' :
                          sd.status === 'INADIMPLENTE' ? 'bg-red-500' : 'bg-zinc-400'
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <Input
            placeholder="Buscar por nome, email, telefone, CNPJ ou código..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 border-zinc-200"
          />
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filterPlan}
            onChange={(e) => setFilterPlan(e.target.value)}
            className="h-9 px-3 rounded-lg border border-zinc-200 text-sm text-zinc-700 bg-white"
          >
            <option value="">Todos os Planos</option>
            <option value="FREE">Free</option>
            <option value="PRO">Pro</option>
            <option value="PRO_PLUS">Pro+</option>
            <option value="PREMIUM">Premium</option>
          </select>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="h-9 px-3 rounded-lg border border-zinc-200 text-sm text-zinc-700 bg-white"
          >
            <option value="">Todos os Status</option>
            <option value="ATIVA">Ativa</option>
            <option value="TRIAL">Trial</option>
            <option value="INADIMPLENTE">Inadimplente</option>
            <option value="CANCELADA">Cancelada</option>
          </select>
        </div>
      </div>

      {/* Subscribers Table */}
      <Card className="border-zinc-200/60">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-zinc-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-zinc-500" />
            Assinantes ({subscribers.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              <span className="ml-2 text-zinc-500">Carregando assinantes...</span>
            </div>
          ) : subscribers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Users className="w-12 h-12 text-zinc-300 mb-3" />
              <p className="text-zinc-500">Nenhum assinante encontrado</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-zinc-200">
                  <tr>
                    <th className="h-10 px-4 text-left font-medium text-zinc-500 text-xs">Código</th>
                    <th className="h-10 px-4 text-left font-medium text-zinc-500 text-xs">Oficina</th>
                    <th className="h-10 px-4 text-left font-medium text-zinc-500 text-xs">Email</th>
                    <th className="h-10 px-4 text-left font-medium text-zinc-500 text-xs">Telefone</th>
                    <th className="h-10 px-4 text-left font-medium text-zinc-500 text-xs">Plano</th>
                    <th className="h-10 px-4 text-left font-medium text-zinc-500 text-xs">Status</th>
                    <th className="h-10 px-4 text-right font-medium text-zinc-500 text-xs">Valor</th>
                    <th className="h-10 px-4 text-left font-medium text-zinc-500 text-xs">Desde</th>
                    <th className="h-10 px-4 text-right font-medium text-zinc-500 text-xs"></th>
                  </tr>
                </thead>
                <tbody>
                  {subscribers.map((sub) => {
                    const planCfg = PLAN_CONFIG[sub.plan] || PLAN_CONFIG.FREE
                    const statusCfg = STATUS_CONFIG[sub.status] || STATUS_CONFIG.ATIVA
                    return (
                      <tr
                        key={sub.id}
                        className="border-b border-zinc-100 hover:bg-emerald-50/50 cursor-pointer transition-colors"
                        onClick={() => setSelectedSubscriber(sub)}
                      >
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-bold text-zinc-700 bg-zinc-100 px-2 py-1 rounded">
                            {sub.subscriptionCode || 'N/A'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="font-medium text-zinc-900">{sub.office.name}</p>
                            <p className="text-xs text-zinc-500">{sub.office.cnpj}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 text-zinc-600">
                            <Mail className="w-3 h-3 text-zinc-400 shrink-0" />
                            <span className="truncate max-w-[160px]">{sub.ownerEmail}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 text-zinc-600">
                            <Phone className="w-3 h-3 text-zinc-400 shrink-0" />
                            <span>{sub.office.phone || '—'}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={planCfg.color}>
                            {planCfg.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={statusCfg.color}>
                            {statusCfg.label}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-emerald-700">
                          {sub.monthlyPrice > 0 ? formatCurrency(sub.monthlyPrice) : 'Grátis'}
                        </td>
                        <td className="px-4 py-3 text-zinc-500">
                          {formatDate(sub.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight className="w-4 h-4 text-zinc-400" />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
