'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  CreditCard,
  Check,
  X,
  Crown,
  Zap,
  Rocket,
  Star,
  Loader2,
  AlertTriangle,
  Bot,
  MessageSquare,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  ExternalLink,
  Shield,
  Clock,
  Settings,
} from 'lucide-react'

// ==================== TYPES ====================
interface PlanDetails {
  maxOS: number
  maxClients: number
  maxParts: number
  aiAccess: boolean
  whatsapp: boolean
  price: number
}

interface SubscriptionData {
  id: string
  plan: string
  status: string
  startDate: string
  endDate: string | null
  trialEndDate: string | null
  monthlyPrice: number
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  mpPreferenceId?: string | null
  mpPaymentId?: string | null
  mpStatus?: string | null
}

interface SubscriptionCheck {
  hasSubscription: boolean
  subscription: SubscriptionData
  planDetails: PlanDetails
  features: PlanDetails
  billingStatus: string
  isOverdue: boolean
  isPendingPayment?: boolean
  pendingPlan?: string | null
  currentUsage: {
    os: number
    clients: number
    parts: number
  }
  limitsReached: {
    os: boolean
    clients: boolean
    parts: boolean
  }
}

const PLANS: Record<string, PlanDetails & { label: string; description: string; icon: React.ComponentType<{ className?: string }> }> = {
  FREE: {
    label: 'Free',
    description: 'Para começar a organizar sua oficina',
    maxOS: 10, maxClients: 20, maxParts: 50,
    aiAccess: false, whatsapp: false, price: 0,
    icon: Zap,
  },
  PRO: {
    label: 'Pro',
    description: 'Para oficinas em crescimento',
    maxOS: 100, maxClients: 200, maxParts: 500,
    aiAccess: true, whatsapp: false, price: 99.90,
    icon: Rocket,
  },
  PRO_PLUS: {
    label: 'Pro+',
    description: 'Para oficinas consolidadas',
    maxOS: 500, maxClients: 1000, maxParts: 2000,
    aiAccess: true, whatsapp: true, price: 199.90,
    icon: Crown,
  },
  PREMIUM: {
    label: 'Premium',
    description: 'Sem limites, máxima potência',
    maxOS: -1, maxClients: -1, maxParts: -1,
    aiAccess: true, whatsapp: true, price: 349.90,
    icon: Star,
  },
}

const PLAN_ORDER = ['FREE', 'PRO', 'PRO_PLUS', 'PREMIUM']

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  ATIVA: { label: 'Ativa', className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' },
  TRIAL: { label: 'Trial', className: 'bg-blue-100 text-blue-800 hover:bg-blue-100' },
  INADIMPLENTE: { label: 'Inadimplente', className: 'bg-red-100 text-red-800 hover:bg-red-100' },
  CANCELADA: { label: 'Cancelada', className: 'bg-zinc-100 text-zinc-800 hover:bg-zinc-100' },
  PENDENTE: { label: 'Aguardando Pagamento', className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100' },
}

function formatCurrency(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

// ==================== MAIN COMPONENT ====================
export function SubscriptionsModule() {
  const { office } = useAuthStore()
  const officeId = office?.id

  const [subData, setSubData] = useState<SubscriptionCheck | null>(null)
  const [loading, setLoading] = useState(true)
  const [changingPlan, setChangingPlan] = useState<string | null>(null)
  const [alert, setAlert] = useState<{ type: 'success' | 'error' | 'warning'; message: string } | null>(null)
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean
    planKey: string
    isUpgrade: boolean
  }>({ open: false, planKey: '', isUpgrade: true })
  const [processingPayment, setProcessingPayment] = useState(false)

  const fetchSubscription = useCallback(async () => {
    if (!officeId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/subscriptions/check?officeId=${officeId}`)
      if (res.success) {
        setSubData(res.data)
      }
    } catch {
      setAlert({ type: 'error', message: 'Erro ao carregar dados da assinatura' })
    } finally {
      setLoading(false)
    }
  }, [officeId])

  useEffect(() => {
    fetchSubscription()
  }, [fetchSubscription])

  useEffect(() => {
    if (alert) {
      const timer = setTimeout(() => setAlert(null), 10000)
      return () => clearTimeout(timer)
    }
  }, [alert])

  // Check for MP return params in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const mpReturn = params.get('mp_return')
    const subId = params.get('sub')

    if (mpReturn) {
      // Clean URL
      window.history.replaceState({}, '', window.location.pathname)

      if (mpReturn === 'success') {
        setAlert({ type: 'success', message: 'Pagamento realizado! Aguardando confirmação do Mercado Pago. Seu plano será ativado automaticamente após a confirmação.' })
        fetchSubscription()
      } else if (mpReturn === 'pending') {
        setAlert({ type: 'warning', message: 'Pagamento pendente. Assim que o Mercado Pago confirmar o pagamento, seu plano será ativado automaticamente.' })
        fetchSubscription()
      } else if (mpReturn === 'failure') {
        setAlert({ type: 'error', message: 'O pagamento não foi concluído. Nenhuma alteração foi feita no seu plano. Tente novamente.' })
      } else if (mpReturn === 'error') {
        setAlert({ type: 'error', message: 'Erro ao processar o retorno do pagamento. Nenhuma alteração foi feita no seu plano.' })
      }
    }
  }, [fetchSubscription])

  const handlePlanClick = (planKey: string) => {
    const currentPlanKey = subData?.isPendingPayment ? 'FREE' : (subData?.subscription?.plan || 'FREE')
    const planIndex = PLAN_ORDER.indexOf(planKey)
    const currentPlanIndex = PLAN_ORDER.indexOf(currentPlanKey)
    const isUpgrade = planIndex > currentPlanIndex

    setConfirmDialog({ open: true, planKey, isUpgrade })
  }

  // Handle downgrade to FREE (no payment needed)
  const handleDowngradeToFree = async () => {
    if (!officeId || !subData) return
    setChangingPlan('FREE')
    try {
      if (subData.subscription) {
        await apiFetch(`/api/subscriptions/${subData.subscription.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ officeId, status: 'CANCELADA' }),
        })
      }

      const res = await apiFetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officeId, plan: 'FREE' }),
      })

      if (res.success) {
        setAlert({ type: 'success', message: 'Plano alterado para Free com sucesso!' })
        fetchSubscription()
      } else {
        setAlert({ type: 'error', message: res.error || 'Erro ao alterar plano' })
      }
    } catch {
      setAlert({ type: 'error', message: 'Erro de conexão ao alterar plano' })
    } finally {
      setChangingPlan(null)
    }
  }

  // Handle paid plan - MUST go through Mercado Pago
  const handleConfirmPayment = async () => {
    const { planKey } = confirmDialog
    if (!officeId) return

    // FREE plan doesn't need MP payment - do direct change
    if (planKey === 'FREE') {
      setConfirmDialog({ ...confirmDialog, open: false })
      await handleDowngradeToFree()
      return
    }

    setProcessingPayment(true)

    try {
      // Create MP payment preference
      const res = await apiFetch('/api/mercadopago/create-subscription', {
        method: 'POST',
        body: JSON.stringify({ officeId, plan: planKey }),
      })

      if (res.success && res.data?.checkoutUrl) {
        // Redirect to Mercado Pago checkout page
        window.location.href = res.data.checkoutUrl
      } else {
        // MP not configured or has errors - DO NOT activate the plan
        // Show error message instead
        const errorMsg = res.error || 'Erro ao criar pagamento'
        setProcessingPayment(false)

        if (res.requiresConfig) {
          setAlert({
            type: 'error',
            message: 'Mercado Pago não configurado. Vá em Configurações da Oficina, aba Mercado Pago, e configure seu Access Token para assinar planos pagos.'
          })
        } else {
          setAlert({
            type: 'error',
            message: `Não foi possível iniciar o pagamento: ${errorMsg}. Nenhuma alteração foi feita no seu plano.`
          })
        }
        setConfirmDialog({ ...confirmDialog, open: false })
      }
    } catch {
      setAlert({ type: 'error', message: 'Erro de conexão ao processar pagamento. Nenhuma alteração foi feita no seu plano.' })
      setProcessingPayment(false)
      setConfirmDialog({ ...confirmDialog, open: false })
    }
  }

  // The effective plan key - if payment is pending, show as FREE
  const currentPlanKey = subData?.isPendingPayment ? 'FREE' : (subData?.subscription?.plan || 'FREE')
  const currentPlanIndex = PLAN_ORDER.indexOf(currentPlanKey)

  // MP status badge
  const getMpStatusBadge = (mpStatus?: string | null) => {
    if (!mpStatus) return null
    const map: Record<string, { label: string; className: string }> = {
      pending: { label: 'Pagamento Pendente', className: 'bg-yellow-100 text-yellow-800' },
      approved: { label: 'Pagamento Aprovado', className: 'bg-emerald-100 text-emerald-800' },
      rejected: { label: 'Pagamento Rejeitado', className: 'bg-red-100 text-red-800' },
      cancelled: { label: 'Pagamento Cancelado', className: 'bg-zinc-100 text-zinc-800' },
      in_process: { label: 'Processando', className: 'bg-blue-100 text-blue-800' },
      in_mediation: { label: 'Em Mediação', className: 'bg-orange-100 text-orange-800' },
    }
    const status = map[mpStatus]
    if (!status) return null
    return <Badge className={status.className}>{status.label}</Badge>
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
        <span className="ml-3 text-zinc-600">Carregando assinatura...</span>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Alert */}
      {alert && (
        <Alert
          variant={alert.type === 'error' ? 'destructive' : 'default'}
          className={
            alert.type === 'success'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : alert.type === 'warning'
              ? 'border-yellow-300 bg-yellow-50 text-yellow-800'
              : undefined
          }
        >
          {alert.type === 'success' ? <Check className="h-4 w-4" /> : alert.type === 'warning' ? <Clock className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          <AlertDescription>{alert.message}</AlertDescription>
        </Alert>
      )}

      {/* Pending Payment Banner - shown when subscription is awaiting MP payment */}
      {subData?.isPendingPayment && (
        <Card className="border-yellow-300 bg-gradient-to-r from-yellow-50 to-orange-50">
          <CardContent className="pt-6">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-yellow-500 flex items-center justify-center shrink-0">
                <Clock className="w-6 h-6 text-white" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-yellow-900">
                  Pagamento Pendente - Plano {PLANS[subData.pendingPlan || '']?.label || subData.pendingPlan}
                </h3>
                <p className="text-sm text-yellow-800">
                  Você selecionou o plano <strong>{PLANS[subData.pendingPlan || '']?.label || subData.pendingPlan}</strong> mas o pagamento ainda não foi confirmado pelo Mercado Pago.
                  Seu plano permanecerá como <strong>Free</strong> até que o pagamento seja confirmado.
                </p>
                {subData.subscription?.mpStatus === 'pending' && (
                  <p className="text-xs text-yellow-700 mt-2">
                    Aguardando confirmação do pagamento via Mercado Pago. Assim que o pagamento for aprovado, seu plano será ativado automaticamente.
                  </p>
                )}
                {subData.subscription?.mpStatus === 'rejected' && (
                  <div className="mt-2">
                    <p className="text-xs text-red-600 font-medium">O pagamento foi rejeitado. Tente novamente selecionando o plano desejado.</p>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Plan Card */}
      {subData && (
        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50 to-zinc-50">
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <CreditCard className="w-5 h-5 text-emerald-600" />
                  Plano Atual
                </CardTitle>
                <CardDescription>Gerencie sua assinatura e limites de uso</CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className={STATUS_MAP[subData.billingStatus]?.className || 'bg-zinc-100 text-zinc-800'}>
                  {STATUS_MAP[subData.billingStatus]?.label || subData.billingStatus}
                </Badge>
                {subData.isOverdue && (
                  <Badge variant="destructive">Inadimplente</Badge>
                )}
                {getMpStatusBadge(subData.subscription?.mpStatus)}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Plan Info */}
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  {(() => {
                    const Icon = PLANS[currentPlanKey]?.icon || Zap
                    return <div className="w-12 h-12 rounded-xl bg-emerald-600 flex items-center justify-center"><Icon className="w-6 h-6 text-white" /></div>
                  })()}
                  <div>
                    <h3 className="text-2xl font-bold text-zinc-900">{PLANS[currentPlanKey]?.label || currentPlanKey}</h3>
                    <p className="text-sm text-zinc-600">{PLANS[currentPlanKey]?.description}</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-zinc-500">Início</p>
                    <p className="font-medium">{formatDate(subData.subscription?.startDate)}</p>
                  </div>
                  <div>
                    <p className="text-zinc-500">Próxima cobrança</p>
                    <p className="font-medium">{formatDate(subData.subscription?.currentPeriodEnd)}</p>
                  </div>
                  {subData.subscription?.trialEndDate && (
                    <div>
                      <p className="text-zinc-500">Fim do Trial</p>
                      <p className="font-medium">{formatDate(subData.subscription.trialEndDate)}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-zinc-500">Valor mensal</p>
                    <p className="font-semibold text-emerald-700 text-lg">{formatCurrency(subData.planDetails.price)}</p>
                  </div>
                </div>
              </div>

              {/* Usage */}
              <div className="space-y-4">
                <h4 className="font-semibold text-sm text-zinc-700">Uso Atual</h4>
                {/* OS Usage */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600">Ordens de Serviço</span>
                    <span className={`font-medium ${subData.limitsReached.os ? 'text-red-600' : 'text-zinc-900'}`}>
                      {subData.currentUsage.os}/{subData.features.maxOS === -1 ? '∞' : subData.features.maxOS}
                    </span>
                  </div>
                  <Progress
                    value={subData.features.maxOS === -1 ? 10 : (subData.currentUsage.os / subData.features.maxOS) * 100}
                    className={`h-2 ${subData.limitsReached.os ? '[&>div]:bg-red-500' : '[&>div]:bg-emerald-500'}`}
                  />
                  {subData.limitsReached.os && <p className="text-xs text-red-600">Limite atingido!</p>}
                </div>
                {/* Clients Usage */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600">Clientes</span>
                    <span className={`font-medium ${subData.limitsReached.clients ? 'text-red-600' : 'text-zinc-900'}`}>
                      {subData.currentUsage.clients}/{subData.features.maxClients === -1 ? '∞' : subData.features.maxClients}
                    </span>
                  </div>
                  <Progress
                    value={subData.features.maxClients === -1 ? 10 : (subData.currentUsage.clients / subData.features.maxClients) * 100}
                    className={`h-2 ${subData.limitsReached.clients ? '[&>div]:bg-red-500' : '[&>div]:bg-emerald-500'}`}
                  />
                  {subData.limitsReached.clients && <p className="text-xs text-red-600">Limite atingido!</p>}
                </div>
                {/* Parts Usage */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-600">Peças</span>
                    <span className={`font-medium ${subData.limitsReached.parts ? 'text-red-600' : 'text-zinc-900'}`}>
                      {subData.currentUsage.parts}/{subData.features.maxParts === -1 ? '∞' : subData.features.maxParts}
                    </span>
                  </div>
                  <Progress
                    value={subData.features.maxParts === -1 ? 10 : (subData.currentUsage.parts / subData.features.maxParts) * 100}
                    className={`h-2 ${subData.limitsReached.parts ? '[&>div]:bg-red-500' : '[&>div]:bg-emerald-500'}`}
                  />
                  {subData.limitsReached.parts && <p className="text-xs text-red-600">Limite atingido!</p>}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Plan Comparison Grid */}
      <div>
        <h2 className="text-lg font-semibold text-zinc-900 mb-4">Compare os Planos</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLAN_ORDER.map((planKey) => {
            const plan = PLANS[planKey]
            const isCurrent = planKey === currentPlanKey
            const planIndex = PLAN_ORDER.indexOf(planKey)
            const isUpgrade = planIndex > currentPlanIndex
            const isDowngrade = planIndex < currentPlanIndex
            const Icon = plan.icon
            const isPopular = planKey === 'PRO_PLUS'

            return (
              <Card
                key={planKey}
                className={`relative transition-all ${
                  isCurrent
                    ? 'border-2 border-emerald-500 shadow-lg shadow-emerald-500/10'
                    : isPopular
                    ? 'border-2 border-blue-400 shadow-md shadow-blue-500/10'
                    : 'border border-zinc-200 hover:border-zinc-300 hover:shadow-md'
                }`}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">Plano Atual</Badge>
                  </div>
                )}
                {!isCurrent && isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-blue-500 text-white hover:bg-blue-500">Mais Popular</Badge>
                  </div>
                )}
                <CardHeader className="text-center pb-2">
                  <div className={`w-12 h-12 rounded-xl mx-auto mb-2 flex items-center justify-center ${
                    isCurrent ? 'bg-emerald-600' : isPopular ? 'bg-blue-500' : 'bg-zinc-100'
                  }`}>
                    <Icon className={`w-6 h-6 ${isCurrent || isPopular ? 'text-white' : 'text-zinc-600'}`} />
                  </div>
                  <CardTitle className="text-xl">{plan.label}</CardTitle>
                  <CardDescription className="text-xs">{plan.description}</CardDescription>
                  <div className="pt-2">
                    <span className="text-3xl font-bold text-zinc-900">
                      {plan.price === 0 ? 'Grátis' : formatCurrency(plan.price)}
                    </span>
                    {plan.price > 0 && <span className="text-sm text-zinc-500">/mês</span>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Features */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>OS: {plan.maxOS === -1 ? 'Ilimitadas' : plan.maxOS}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>Clientes: {plan.maxClients === -1 ? 'Ilimitados' : plan.maxClients}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>Peças: {plan.maxParts === -1 ? 'Ilimitadas' : plan.maxParts}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {plan.aiAccess ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-600" />
                          <span className="flex items-center gap-1">
                            <Bot className="w-3 h-3" /> IA Assistente
                          </span>
                        </>
                      ) : (
                        <>
                          <X className="w-4 h-4 text-zinc-400" />
                          <span className="text-zinc-500">IA Assistente</span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {plan.whatsapp ? (
                        <>
                          <Check className="w-4 h-4 text-emerald-600" />
                          <span className="flex items-center gap-1">
                            <MessageSquare className="w-3 h-3" /> WhatsApp
                          </span>
                        </>
                      ) : (
                        <>
                          <X className="w-4 h-4 text-zinc-400" />
                          <span className="text-zinc-500">WhatsApp</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="pt-3">
                    {isCurrent ? (
                      <Button variant="outline" className="w-full" disabled>
                        <Check className="w-4 h-4 mr-1" /> Plano Atual
                      </Button>
                    ) : isUpgrade ? (
                      <Button
                        className={`w-full ${isPopular ? 'bg-blue-500 hover:bg-blue-600' : 'bg-emerald-600 hover:bg-emerald-700'}`}
                        onClick={() => handlePlanClick(planKey)}
                        disabled={changingPlan !== null || processingPayment}
                      >
                        {changingPlan === planKey ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <ArrowUpRight className="w-4 h-4 mr-1" />
                        )}
                        Upgrade
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => handlePlanClick(planKey)}
                        disabled={changingPlan !== null}
                      >
                        {changingPlan === planKey ? (
                          <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                        ) : (
                          <ArrowDownRight className="w-4 h-4 mr-1" />
                        )}
                        Downgrade
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>

      {/* Billing Info */}
      {subData && subData.planDetails.price > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Calendar className="w-5 h-5 text-emerald-600" />
              Informações de Cobrança
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-zinc-500">Período Atual</p>
                <p className="font-medium">
                  {formatDate(subData.subscription?.currentPeriodStart)} — {formatDate(subData.subscription?.currentPeriodEnd)}
                </p>
              </div>
              <div>
                <p className="text-zinc-500">Valor</p>
                <p className="font-semibold text-emerald-700">{formatCurrency(subData.planDetails.price)}/mês</p>
              </div>
              <div>
                <p className="text-zinc-500">Status</p>
                <Badge className={STATUS_MAP[subData.billingStatus]?.className || ''}>
                  {STATUS_MAP[subData.billingStatus]?.label || subData.billingStatus}
                </Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Payment Confirmation Dialog */}
      <Dialog open={confirmDialog.open} onOpenChange={(open) => {
        if (!processingPayment) setConfirmDialog({ ...confirmDialog, open })
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-emerald-600" />
              Confirmar {confirmDialog.isUpgrade ? 'Upgrade' : 'Downgrade'}
            </DialogTitle>
            <DialogDescription>
              {confirmDialog.planKey === 'FREE'
                ? 'Ao fazer downgrade para o plano Free, você perderá acesso a funcionalidades premium.'
                : confirmDialog.isUpgrade
                ? 'Você será redirecionado para a página de pagamento seguro do Mercado Pago. O plano só será ativado após a confirmação do pagamento.'
                : 'Ao fazer downgrade, seu plano será alterado imediatamente.'}
            </DialogDescription>
          </DialogHeader>

          {confirmDialog.planKey && (
            <div className="space-y-4 py-4">
              {/* Plan Summary */}
              <div className="bg-zinc-50 rounded-lg p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-600">Plano atual</span>
                  <span className="font-semibold">{PLANS[currentPlanKey]?.label}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-600">Novo plano</span>
                  <span className={`font-semibold ${confirmDialog.isUpgrade ? 'text-emerald-700' : 'text-orange-600'}`}>
                    {PLANS[confirmDialog.planKey]?.label}
                  </span>
                </div>
                <hr className="border-zinc-200" />
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-600">Valor mensal</span>
                  <span className={`text-xl font-bold ${confirmDialog.isUpgrade ? 'text-emerald-700' : 'text-orange-600'}`}>
                    {PLANS[confirmDialog.planKey]?.price === 0 ? 'Grátis' : formatCurrency(PLANS[confirmDialog.planKey]?.price || 0)}
                  </span>
                </div>
              </div>

              {/* Features Preview */}
              <div className="space-y-2">
                <p className="text-sm font-medium text-zinc-700">
                  {confirmDialog.isUpgrade ? 'O que você vai ganhar:' : 'O que muda:'}
                </p>
                {PLANS[confirmDialog.planKey] && (
                  <>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>OS: {PLANS[confirmDialog.planKey].maxOS === -1 ? 'Ilimitadas' : PLANS[confirmDialog.planKey].maxOS}</span>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>Clientes: {PLANS[confirmDialog.planKey].maxClients === -1 ? 'Ilimitados' : PLANS[confirmDialog.planKey].maxClients}</span>
                    </div>
                    {PLANS[confirmDialog.planKey].aiAccess && (
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-emerald-600" />
                        <span className="flex items-center gap-1"><Bot className="w-3 h-3" /> IA Assistente</span>
                      </div>
                    )}
                    {!PLANS[confirmDialog.planKey].aiAccess && PLANS[currentPlanKey]?.aiAccess && (
                      <div className="flex items-center gap-2 text-sm">
                        <X className="w-4 h-4 text-red-500" />
                        <span className="text-red-600 flex items-center gap-1"><Bot className="w-3 h-3" /> Sem IA Assistente</span>
                      </div>
                    )}
                    {PLANS[confirmDialog.planKey].whatsapp && (
                      <div className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-emerald-600" />
                        <span className="flex items-center gap-1"><MessageSquare className="w-3 h-3" /> WhatsApp</span>
                      </div>
                    )}
                    {!PLANS[confirmDialog.planKey].whatsapp && PLANS[currentPlanKey]?.whatsapp && (
                      <div className="flex items-center gap-2 text-sm">
                        <X className="w-4 h-4 text-red-500" />
                        <span className="text-red-600 flex items-center gap-1"><MessageSquare className="w-3 h-3" /> Sem WhatsApp</span>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Security Info - only for paid plans */}
              {confirmDialog.isUpgrade && confirmDialog.planKey !== 'FREE' && (
                <div className="flex items-start gap-3 bg-blue-50 rounded-lg p-3">
                  <Shield className="w-5 h-5 text-blue-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-blue-700">
                    <p className="font-semibold">Pagamento seguro via Mercado Pago</p>
                    <p>Você será redirecionado para a página oficial do Mercado Pago, onde pode pagar com PIX, cartão de crédito ou boleto. O plano só será ativado após a confirmação do pagamento.</p>
                  </div>
                </div>
              )}

              {/* Downgrade warning */}
              {!confirmDialog.isUpgrade && (
                <div className="flex items-start gap-3 bg-orange-50 rounded-lg p-3">
                  <AlertTriangle className="w-5 h-5 text-orange-600 mt-0.5 shrink-0" />
                  <div className="text-xs text-orange-700">
                    <p className="font-semibold">Atenção ao fazer downgrade</p>
                    <p>Seus dados serão preservados, mas você perderá acesso a funcionalidades do plano superior caso exceda os limites do novo plano.</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDialog({ ...confirmDialog, open: false })}
              disabled={processingPayment}
            >
              Cancelar
            </Button>
            <Button
              className={confirmDialog.isUpgrade ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-orange-600 hover:bg-orange-700'}
              onClick={handleConfirmPayment}
              disabled={processingPayment}
            >
              {processingPayment ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Preparando pagamento...
                </>
              ) : confirmDialog.isUpgrade ? (
                <>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Ir para pagamento
                </>
              ) : (
                <>
                  <ArrowDownRight className="w-4 h-4 mr-2" />
                  Confirmar downgrade
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
