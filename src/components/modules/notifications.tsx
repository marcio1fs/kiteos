'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Bell,
  Plus,
  Send,
  RefreshCw,
  Loader2,
  MessageSquare,
  Mail,
  Monitor,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
} from 'lucide-react'

// ==================== TYPES ====================
interface Notification {
  id: string
  type: string
  template: string | null
  title: string
  message: string
  recipient: string | null
  status: string
  sentAt: string | null
  serviceOrderId: string | null
  officeId: string
  createdAt: string
  serviceOrder?: {
    id: string
    number: string
    status: string
  } | null
}

const TYPE_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  WHATSAPP: { label: 'WhatsApp', icon: MessageSquare, className: 'bg-green-100 text-green-800 hover:bg-green-100' },
  EMAIL: { label: 'Email', icon: Mail, className: 'bg-blue-100 text-blue-800 hover:bg-blue-100' },
  SYSTEM: { label: 'Sistema', icon: Monitor, className: 'bg-zinc-100 text-zinc-800 hover:bg-zinc-100' },
}

const STATUS_CONFIG: Record<string, { label: string; icon: React.ComponentType<{ className?: string }>; className: string }> = {
  PENDENTE: { label: 'Pendente', icon: Clock, className: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100' },
  ENVIADA: { label: 'Enviada', icon: CheckCircle2, className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' },
  FALHOU: { label: 'Falhou', icon: XCircle, className: 'bg-red-100 text-red-800 hover:bg-red-100' },
}

const TEMPLATES = [
  { value: 'OS_CRIADA', label: 'OS Criada' },
  { value: 'OS_FINALIZADA', label: 'OS Finalizada' },
  { value: 'PAGAMENTO_PENDENTE', label: 'Pagamento Pendente' },
  { value: 'LEMBRETE', label: 'Lembrete' },
]

const TEMPLATE_MESSAGES: Record<string, string> = {
  OS_CRIADA: 'Sua ordem de serviço foi criada com sucesso. Acompanhe o andamento pelo sistema.',
  OS_FINALIZADA: 'Sua ordem de serviço foi finalizada. Entre em contato para agendar a retirada do veículo.',
  PAGAMENTO_PENDENTE: 'Você possui um pagamento pendente. Por favor, entre em contato para regularizar.',
  LEMBRETE: 'Lembrete: ',
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ==================== MAIN COMPONENT ====================
export function NotificationsModule() {
  const { office, user } = useAuthStore()
  const officeId = office?.id

  // List state
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [typeFilter, setTypeFilter] = useState<string>('ALL')
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [searchTerm, setSearchTerm] = useState('')
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 })

  // Create dialog state
  const [createOpen, setCreateOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [form, setForm] = useState({
    type: 'SYSTEM',
    template: '',
    recipient: '',
    title: '',
    message: '',
  })

  // Resend state
  const [resending, setResending] = useState<string | null>(null)

  // Alert
  const [alert, setAlert] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const fetchNotifications = useCallback(async (page = 1) => {
    if (!officeId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ officeId, page: String(page), limit: '20' })
      if (typeFilter !== 'ALL') params.set('type', typeFilter)
      if (statusFilter !== 'ALL') params.set('status', statusFilter)

      const res = await apiFetch(`/api/notifications?${params}`)
      if (res.success) {
        setNotifications(res.data?.notifications || [])
        setPagination(res.data?.pagination || { page: 1, totalPages: 1, total: 0 })
      }
    } catch {
      setAlert({ type: 'error', message: 'Erro ao carregar notificações' })
    } finally {
      setLoading(false)
    }
  }, [officeId, typeFilter, statusFilter])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  useEffect(() => {
    if (alert) {
      const timer = setTimeout(() => setAlert(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [alert])

  // ---- Create Notification ----
  const handleCreate = async () => {
    if (!officeId) return
    setSending(true)
    try {
      const res = await apiFetch('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId,
          userId: user?.id,
          type: form.type,
          template: form.template || null,
          title: form.title,
          message: form.message,
          recipient: form.recipient || null,
        }),
      })
      if (res.success) {
        setCreateOpen(false)
        setAlert({ type: 'success', message: 'Notificação enviada com sucesso!' })
        setForm({ type: 'SYSTEM', template: '', recipient: '', title: '', message: '' })
        fetchNotifications()
      } else {
        setAlert({ type: 'error', message: res.errors?.join(', ') || 'Erro ao enviar notificação' })
      }
    } catch {
      setAlert({ type: 'error', message: 'Erro de conexão ao enviar notificação' })
    } finally {
      setSending(false)
    }
  }

  // ---- Resend ----
  const handleResend = async (notification: Notification) => {
    if (!officeId) return
    setResending(notification.id)
    try {
      const res = await apiFetch('/api/notifications/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId,
          userId: user?.id,
          type: notification.type,
          template: notification.template,
          title: notification.title,
          message: notification.message,
          recipient: notification.recipient,
        }),
      })
      if (res.success) {
        setAlert({ type: 'success', message: 'Notificação reenviada com sucesso!' })
        fetchNotifications()
      } else {
        setAlert({ type: 'error', message: res.errors?.join(', ') || 'Erro ao reenviar' })
      }
    } catch {
      setAlert({ type: 'error', message: 'Erro de conexão ao reenviar' })
    } finally {
      setResending(null)
    }
  }

  // ---- Template change ----
  const handleTemplateChange = (templateValue: string) => {
    setForm(prev => ({
      ...prev,
      template: templateValue,
      message: TEMPLATE_MESSAGES[templateValue] || prev.message,
    }))
  }

  // ---- Filtered notifications ----
  const filteredNotifications = notifications.filter(n => {
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      return (
        n.title.toLowerCase().includes(term) ||
        n.message.toLowerCase().includes(term) ||
        n.recipient?.toLowerCase().includes(term)
      )
    }
    return true
  })

  return (
    <div className="space-y-6">
      {/* Alert */}
      {alert && (
        <Alert variant={alert.type === 'error' ? 'destructive' : 'default'} className={
          alert.type === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : undefined
        }>
          {alert.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
          <AlertDescription>{alert.message}</AlertDescription>
        </Alert>
      )}

      {/* Notifications List Card */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Bell className="w-5 h-5 text-emerald-600" />
              Notificações
              {pagination.total > 0 && (
                <Badge variant="secondary" className="ml-1">{pagination.total}</Badge>
              )}
            </CardTitle>
            <Button onClick={() => setCreateOpen(true)} className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-1" />
              Nova Notificação
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <Input
                placeholder="Buscar por título, mensagem ou destinatário..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-44">
                <Filter className="w-4 h-4 mr-1" />
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos os Tipos</SelectItem>
                <SelectItem value="WHATSAPP">WhatsApp</SelectItem>
                <SelectItem value="EMAIL">Email</SelectItem>
                <SelectItem value="SYSTEM">Sistema</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos os Status</SelectItem>
                <SelectItem value="PENDENTE">Pendente</SelectItem>
                <SelectItem value="ENVIADA">Enviada</SelectItem>
                <SelectItem value="FALHOU">Falhou</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Destinatário</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-zinc-500">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                      Carregando notificações...
                    </TableCell>
                  </TableRow>
                ) : filteredNotifications.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-8 text-zinc-500">
                      Nenhuma notificação encontrada
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredNotifications.map((notif) => {
                    const typeConf = TYPE_CONFIG[notif.type] || TYPE_CONFIG.SYSTEM
                    const statusConf = STATUS_CONFIG[notif.status] || STATUS_CONFIG.PENDENTE
                    const TypeIcon = typeConf.icon
                    return (
                      <TableRow key={notif.id}>
                        <TableCell>
                          <Badge variant="secondary" className={`gap-1 ${typeConf.className}`}>
                            <TypeIcon className="w-3 h-3" />
                            {typeConf.label}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-sm max-w-[200px] truncate" title={notif.title}>{notif.title}</p>
                          <p className="text-xs text-zinc-500 max-w-[250px] truncate" title={notif.message}>{notif.message}</p>
                        </TableCell>
                        <TableCell className="text-sm">{notif.recipient || '—'}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={statusConf.className}>
                            {notif.status === 'ENVIADA' && <CheckCircle2 className="w-3 h-3 mr-1" />}
                            {notif.status === 'FALHOU' && <XCircle className="w-3 h-3 mr-1" />}
                            {notif.status === 'PENDENTE' && <Clock className="w-3 h-3 mr-1" />}
                            {statusConf.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-zinc-500">{formatDate(notif.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          {notif.status === 'FALHOU' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleResend(notif)}
                              disabled={resending === notif.id}
                              title="Reenviar"
                              className="text-orange-600 hover:text-orange-700"
                            >
                              {resending === notif.id ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <RefreshCw className="w-4 h-4" />
                              )}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <p className="text-zinc-500">
                {pagination.total} notificação(ões) · Página {pagination.page} de {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagination.page <= 1}
                  onClick={() => fetchNotifications(pagination.page - 1)}
                >
                  Anterior
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagination.page >= pagination.totalPages}
                  onClick={() => fetchNotifications(pagination.page + 1)}
                >
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Notification Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-5 h-5 text-emerald-600" />
              Nova Notificação
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Type */}
            <div className="space-y-1">
              <Label>Tipo *</Label>
              <Select value={form.type} onValueChange={(v) => setForm(p => ({ ...p, type: v }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="WHATSAPP">
                    <span className="flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-green-600" /> WhatsApp
                    </span>
                  </SelectItem>
                  <SelectItem value="EMAIL">
                    <span className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-blue-600" /> Email
                    </span>
                  </SelectItem>
                  <SelectItem value="SYSTEM">
                    <span className="flex items-center gap-2">
                      <Monitor className="w-4 h-4 text-zinc-600" /> Sistema
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Template */}
            <div className="space-y-1">
              <Label>Template</Label>
              <Select value={form.template} onValueChange={handleTemplateChange}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione um template (opcional)" />
                </SelectTrigger>
                <SelectContent>
                  {TEMPLATES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Recipient */}
            <div className="space-y-1">
              <Label>
                Destinatário {form.type === 'WHATSAPP' ? '(telefone) *' : form.type === 'EMAIL' ? '(email) *' : ''}
              </Label>
              <Input
                value={form.recipient}
                onChange={(e) => setForm(p => ({ ...p, recipient: e.target.value }))}
                placeholder={
                  form.type === 'WHATSAPP' ? '5511999999999' :
                  form.type === 'EMAIL' ? 'email@exemplo.com' :
                  'Opcional'
                }
              />
            </div>

            {/* Title */}
            <div className="space-y-1">
              <Label>Título *</Label>
              <Input
                value={form.title}
                onChange={(e) => setForm(p => ({ ...p, title: e.target.value }))}
                placeholder="Título da notificação"
              />
            </div>

            {/* Message */}
            <div className="space-y-1">
              <Label>Mensagem *</Label>
              <Textarea
                value={form.message}
                onChange={(e) => setForm(p => ({ ...p, message: e.target.value }))}
                placeholder="Conteúdo da notificação"
                rows={4}
              />
            </div>

            {/* Warning for WhatsApp/Email */}
            {(form.type === 'WHATSAPP' || form.type === 'EMAIL') && !form.recipient && (
              <Alert className="border-yellow-300 bg-yellow-50 text-yellow-800">
                <AlertDescription className="text-xs">
                  Para notificações do tipo {form.type === 'WHATSAPP' ? 'WhatsApp' : 'Email'}, o destinatário é obrigatório.
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleCreate}
              disabled={sending || !form.title || !form.message}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {sending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Send className="w-4 h-4 mr-1" />}
              Enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
