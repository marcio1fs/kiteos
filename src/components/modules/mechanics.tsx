'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { maskCPF, validateCPF } from '@/lib/validators'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Wrench, Plus, Search, Edit2, Trash2, Phone, Mail, Star,
  DollarSign, Calendar, TrendingUp, ChevronLeft, ChevronRight,
  User, CheckCircle2, XCircle, Loader2, Percent, FileText, Printer
} from 'lucide-react'
import { printReport, buildReportHeader, fmtCurrency } from '@/lib/print-utils'

// =============================================
// TYPES
// =============================================
interface Mechanic {
  id: string
  name: string
  cpf?: string | null
  phone?: string | null
  email?: string | null
  specialty?: string | null
  commissionPct: number
  active: boolean
  deleted: boolean
  officeId: string
  createdAt: string
  updatedAt: string
  _count?: { serviceItems: number }
}

interface CommissionItem {
  id: string
  description: string
  quantity: number
  unitPrice: number
  totalPrice: number
  commissionPct: number
  commissionValue: number
  serviceOrder: {
    number: string
    status: string
    client: { name: string }
    vehicle: { plate: string; model: string }
  }
  createdAt: string
}

interface CommissionReport {
  mechanic: {
    id: string
    name: string
    specialty?: string | null
    commissionPct: number
    phone?: string | null
    active: boolean
  }
  totalServices: number
  totalValue: number
  totalCommission: number
  items: CommissionItem[]
}

interface CommissionData {
  period: {
    start: string
    end: string
    label: string
  }
  mechanics: CommissionReport[]
  totals: {
    totalServices: number
    totalValue: number
    totalCommission: number
  }
}

// =============================================
// FORMAT HELPERS
// =============================================
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatCPF(cpf: string): string {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11) return cpf
  return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
}

function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  if (d.length === 11) return d.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  if (d.length === 10) return d.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  return phone
}

const specialtyLabels: Record<string, string> = {
  'GERAL': 'Geral',
  'MOTOR': 'Motor',
  'ELETRICA': 'Elétrica',
  'SUSPENSAO': 'Suspensão',
  'FREIOS': 'Freios',
  'INJECAO': 'Injeção Eletrônica',
  'TRANSMISSAO': 'Transmissão',
  'AR_CONDICIONADO': 'Ar Condicionado',
  'PINTURA': 'Pintura',
  'LATARIA': 'Lataria',
}

const specialtyOptions = Object.entries(specialtyLabels)

// =============================================
// MAIN COMPONENT
// =============================================
export function MechanicsModule() {
  const { user } = useAuthStore()
  const officeId = user?.officeId || ''

  const [mechanics, setMechanics] = useState<Mechanic[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [commissionOpen, setCommissionOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [selectedMechanic, setSelectedMechanic] = useState<Mechanic | null>(null)
  const [editingMechanic, setEditingMechanic] = useState<Mechanic | null>(null)
  const [commissionData, setCommissionData] = useState<CommissionData | null>(null)
  const [commissionLoading, setCommissionLoading] = useState(false)
  const [commissionMonth, setCommissionMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  const [form, setForm] = useState({
    name: '',
    cpf: '',
    phone: '',
    email: '',
    specialty: '',
    commissionPct: 0,
  })

  // Fetch mechanics
  const fetchMechanics = useCallback(async () => {
    if (!officeId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ officeId })
      if (search) params.set('search', search)
      const data = await apiFetch(`/api/mechanics?${params}`)
      if (data.success) setMechanics(data.data)
    } catch { /* silently handle */ } finally {
      setLoading(false)
    }
  }, [officeId, search])

  useEffect(() => { fetchMechanics() }, [fetchMechanics])

  // Fetch commission report
  const fetchCommission = useCallback(async () => {
    if (!officeId) return
    setCommissionLoading(true)
    try {
      const params = new URLSearchParams({ officeId, month: commissionMonth })
      const data = await apiFetch(`/api/mechanics/commission?${params}`)
      if (data.success) setCommissionData(data.data)
    } catch { /* silently handle */ } finally {
      setCommissionLoading(false)
    }
  }, [officeId, commissionMonth])

  useEffect(() => { if (commissionOpen) fetchCommission() }, [commissionOpen, fetchCommission])

  // Reset form
  const resetForm = () => {
    setForm({ name: '', cpf: '', phone: '', email: '', specialty: '', commissionPct: 0 })
    setEditingMechanic(null)
  }

  // Open form for create
  const handleCreate = () => {
    resetForm()
    setFormOpen(true)
  }

  // Open form for edit
  const handleEdit = (mechanic: Mechanic) => {
    setEditingMechanic(mechanic)
    setForm({
      name: mechanic.name,
      cpf: mechanic.cpf || '',
      phone: mechanic.phone || '',
      email: mechanic.email || '',
      specialty: mechanic.specialty || '',
      commissionPct: mechanic.commissionPct,
    })
    setFormOpen(true)
  }

  // Save mechanic (create or update)
  const handleSave = async () => {
    if (!form.name.trim()) return
    // Validate CPF if provided
    const cpfError = validateCPF(form.cpf)
    if (cpfError) {
      alert(cpfError)
      return
    }
    setSaving(true)
    try {
      if (editingMechanic) {
        await apiFetch(`/api/mechanics/${editingMechanic.id}`, {
          method: 'PUT',
          body: JSON.stringify(form),
        })
      } else {
        await apiFetch('/api/mechanics', {
          method: 'POST',
          body: JSON.stringify({ ...form, officeId }),
        })
      }
      setFormOpen(false)
      resetForm()
      fetchMechanics()
    } catch { /* silently handle */ } finally {
      setSaving(false)
    }
  }

  // Toggle active/inactive
  const handleToggleActive = async (mechanic: Mechanic) => {
    try {
      await apiFetch(`/api/mechanics/${mechanic.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: !mechanic.active }),
      })
      fetchMechanics()
    } catch { /* silently handle */ }
  }

  // Delete mechanic
  const handleDelete = async (mechanic: Mechanic) => {
    if (!confirm(`Excluir mecânico "${mechanic.name}"?`)) return
    try {
      await apiFetch(`/api/mechanics/${mechanic.id}`, { method: 'DELETE' })
      fetchMechanics()
    } catch { /* silently handle */ }
  }

  // View detail
  const handleDetail = (mechanic: Mechanic) => {
    setSelectedMechanic(mechanic)
    setDetailOpen(true)
  }

  // Navigate month
  const navigateMonth = (direction: number) => {
    const [year, month] = commissionMonth.split('-').map(Number)
    const d = new Date(year, month - 1 + direction, 1)
    setCommissionMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  // Print commission report
  const handlePrintCommission = () => {
    if (!commissionData) return
    const officeName = user?.name || 'KiteOS'
    const header = buildReportHeader('Relatório de Comissões', officeName, monthLabel)
    // Summary cards
    const summaryHtml = `
      <div class="summary-grid">
        <div class="summary-card green"><div class="label">Total Serviços</div><div class="value text-green">${commissionData.totals.totalServices}</div></div>
        <div class="summary-card blue"><div class="label">Valor Total</div><div class="value text-blue">${fmtCurrency(commissionData.totals.totalValue)}</div></div>
        <div class="summary-card amber"><div class="label">Total Comissões</div><div class="value text-amber">${fmtCurrency(commissionData.totals.totalCommission)}</div></div>
      </div>
    `
    // Per-mechanic cards
    let mechanicCards = ''
    commissionData.mechanics.forEach((report) => {
      let itemRows = ''
      report.items.forEach((item) => {
        itemRows += `<div class="item-row">
          <div class="item-desc">${item.description}<br/><span style="font-size:10px;color:#666;">OS ${item.serviceOrder.number} · ${item.serviceOrder.client.name} · ${item.serviceOrder.vehicle.plate}</span></div>
          <div class="item-values">${fmtCurrency(item.totalPrice)}<br/><span style="color:#059669;font-size:10px;">${item.commissionPct}% = ${fmtCurrency(item.commissionValue)}</span></div>
        </div>`
      })
      const spLabel = report.mechanic.specialty ? (specialtyLabels[report.mechanic.specialty] || report.mechanic.specialty) : ''
      mechanicCards += `<div class="mechanic-card">
        <div class="mechanic-header">
          <div><div class="mechanic-name">${report.mechanic.name}</div><div style="font-size:11px;color:#666;">${spLabel} · ${report.mechanic.commissionPct}% comissão</div></div>
          <div><div class="commission-value">${fmtCurrency(report.totalCommission)}</div><div style="font-size:10px;color:#666;">${report.totalServices} serviço(s) · ${fmtCurrency(report.totalValue)}</div></div>
        </div>
        ${itemRows || '<div style="text-align:center;color:#999;font-size:11px;padding:8px;">Nenhum serviço finalizado neste período</div>'}
      </div>`
    })
    printReport({ title: 'Relatório de Comissões', contentHtml: header + summaryHtml + mechanicCards })
  }

  const monthLabel = (() => {
    const [y, m] = commissionMonth.split('-').map(Number)
    return new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  })()

  // Active vs inactive counts
  const activeCount = mechanics.filter(m => m.active).length
  const inactiveCount = mechanics.filter(m => !m.active).length

  return (
    <div className="max-w-7xl mx-auto space-y-6 p-4 md:p-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Mecânicos</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Gerencie mecânicos e comissões por serviço realizado
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setCommissionOpen(true)}
            variant="outline"
            className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 gap-2"
          >
            <DollarSign className="w-4 h-4" />
            Relatório de Comissões
          </Button>
          <Button
            onClick={handleCreate}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
          >
            <Plus className="w-4 h-4" />
            Novo Mecânico
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-zinc-200/60">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                <Wrench className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-zinc-900">{mechanics.length}</p>
                <p className="text-xs text-zinc-500">Total de Mecânicos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-zinc-200/60">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-zinc-900">{activeCount}</p>
                <p className="text-xs text-zinc-500">Ativos</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-zinc-200/60">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-zinc-100 flex items-center justify-center">
                <XCircle className="w-5 h-5 text-zinc-400" />
              </div>
              <div>
                <p className="text-2xl font-bold text-zinc-900">{inactiveCount}</p>
                <p className="text-xs text-zinc-500">Inativos</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, especialidade, telefone..."
          className="pl-10 border-zinc-200"
        />
      </div>

      {/* Mechanics Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
        </div>
      ) : mechanics.length === 0 ? (
        <Card className="border-zinc-200/60">
          <CardContent className="py-16 text-center">
            <Wrench className="w-12 h-12 text-zinc-300 mx-auto mb-4" />
            <p className="text-zinc-500 text-sm">
              {search ? 'Nenhum mecânico encontrado' : 'Nenhum mecânico cadastrado'}
            </p>
            <Button onClick={handleCreate} variant="outline" className="mt-4 gap-2">
              <Plus className="w-4 h-4" /> Cadastrar Mecânico
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {mechanics.map((mechanic) => (
            <Card
              key={mechanic.id}
              className={`border-zinc-200/60 hover:shadow-md transition-shadow cursor-pointer ${!mechanic.active ? 'opacity-60' : ''}`}
              onClick={() => handleDetail(mechanic)}
            >
              <CardContent className="pt-6">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <User className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <p className="font-semibold text-zinc-900">{mechanic.name}</p>
                      {mechanic.specialty && (
                        <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 text-[10px] mt-0.5">
                          {specialtyLabels[mechanic.specialty] || mechanic.specialty}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Badge
                    variant={mechanic.active ? 'default' : 'secondary'}
                    className={mechanic.active ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}
                  >
                    {mechanic.active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </div>

                <div className="space-y-1 text-sm text-zinc-500">
                  {mechanic.phone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-3.5 h-3.5" /> {formatPhone(mechanic.phone)}
                    </div>
                  )}
                  {mechanic.email && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5" /> <span className="truncate">{mechanic.email}</span>
                    </div>
                  )}
                </div>

                <Separator className="my-3" />

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Percent className="w-4 h-4 text-emerald-600" />
                    <span className="text-sm font-semibold text-emerald-700">
                      {mechanic.commissionPct}% comissão
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleEdit(mechanic) }}
                      className="h-7 w-7 p-0 text-zinc-400 hover:text-blue-600"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleToggleActive(mechanic) }}
                      className="h-7 w-7 p-0 text-zinc-400 hover:text-amber-600"
                    >
                      {mechanic.active ? <XCircle className="w-3.5 h-3.5" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); handleDelete(mechanic) }}
                      className="h-7 w-7 p-0 text-zinc-400 hover:text-red-600"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ============================================= */}
      {/* CREATE/EDIT FORM DIALOG */}
      {/* ============================================= */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-zinc-900">
              {editingMechanic ? 'Editar Mecânico' : 'Novo Mecânico'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label>Nome completo *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: João Silva"
                  className="border-zinc-200"
                />
              </div>
              <div className="space-y-2">
                <Label>CPF</Label>
                <Input
                  value={form.cpf}
                  onChange={(e) => setForm({ ...form, cpf: maskCPF(e.target.value) })}
                  placeholder="000.000.000-00"
                  className="border-zinc-200"
                  maxLength={14}
                />
              </div>
              <div className="space-y-2">
                <Label>Telefone</Label>
                <Input
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="(77) 99999-0000"
                  className="border-zinc-200"
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Email</Label>
                <Input
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="joao@exemplo.com"
                  type="email"
                  className="border-zinc-200"
                />
              </div>
              <div className="space-y-2">
                <Label>Especialidade</Label>
                <select
                  value={form.specialty}
                  onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                  className="w-full h-9 rounded-md border border-zinc-200 bg-white px-3 text-sm"
                >
                  <option value="">Selecione...</option>
                  {specialtyOptions.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label>Comissão (%)</Label>
                <div className="relative">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    value={form.commissionPct}
                    onChange={(e) => {
                      let val = parseFloat(e.target.value) || 0
                      if (val < 0) val = 0
                      if (val > 100) val = 100
                      setForm({ ...form, commissionPct: val })
                    }}
                    className="border-zinc-200 pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">%</span>
                </div>
                <p className="text-[10px] text-zinc-400">
                  Percentual padrão sobre serviços realizados (0 a 100%)
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setFormOpen(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Salvar'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ============================================= */}
      {/* DETAIL DIALOG */}
      {/* ============================================= */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-zinc-900 flex items-center gap-2">
              <User className="w-5 h-5 text-emerald-600" />
              {selectedMechanic?.name}
            </DialogTitle>
          </DialogHeader>
          {selectedMechanic && (
            <div className="space-y-4 mt-2">
              {/* Info Grid */}
              <div className="grid grid-cols-2 gap-3">
                {selectedMechanic.cpf && (
                  <div className="p-3 rounded-lg bg-zinc-50">
                    <p className="text-xs text-zinc-500">CPF</p>
                    <p className="text-sm font-medium">{formatCPF(selectedMechanic.cpf)}</p>
                  </div>
                )}
                {selectedMechanic.phone && (
                  <div className="p-3 rounded-lg bg-zinc-50">
                    <p className="text-xs text-zinc-500">Telefone</p>
                    <p className="text-sm font-medium">{formatPhone(selectedMechanic.phone)}</p>
                  </div>
                )}
                {selectedMechanic.email && (
                  <div className="p-3 rounded-lg bg-zinc-50">
                    <p className="text-xs text-zinc-500">Email</p>
                    <p className="text-sm font-medium">{selectedMechanic.email}</p>
                  </div>
                )}
                {selectedMechanic.specialty && (
                  <div className="p-3 rounded-lg bg-zinc-50">
                    <p className="text-xs text-zinc-500">Especialidade</p>
                    <p className="text-sm font-medium">{specialtyLabels[selectedMechanic.specialty] || selectedMechanic.specialty}</p>
                  </div>
                )}
                <div className="p-3 rounded-lg bg-emerald-50">
                  <p className="text-xs text-emerald-600">Comissão</p>
                  <p className="text-sm font-bold text-emerald-700">{selectedMechanic.commissionPct}%</p>
                </div>
                <div className="p-3 rounded-lg bg-zinc-50">
                  <p className="text-xs text-zinc-500">Status</p>
                  <Badge
                    variant={selectedMechanic.active ? 'default' : 'secondary'}
                    className={selectedMechanic.active ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'}
                  >
                    {selectedMechanic.active ? 'Ativo' : 'Inativo'}
                  </Badge>
                </div>
              </div>

              <Separator />

              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-zinc-700">Serviços Realizados</h3>
                <span className="text-xs text-zinc-400">
                  {selectedMechanic._count?.serviceItems || 0} serviço(s)
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ============================================= */}
      {/* COMMISSION REPORT DIALOG */}
      {/* ============================================= */}
      <Dialog open={commissionOpen} onOpenChange={setCommissionOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-zinc-900 flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-emerald-600" />
              Relatório de Comissões
            </DialogTitle>
          </DialogHeader>

          {/* Month Navigator */}
          <div className="flex items-center justify-center gap-4 py-2">
            <Button variant="ghost" size="sm" onClick={() => navigateMonth(-1)}>
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <div className="text-center min-w-[200px]">
              <p className="font-semibold text-zinc-900 capitalize">{monthLabel}</p>
              <input
                type="month"
                value={commissionMonth}
                onChange={(e) => setCommissionMonth(e.target.value)}
                className="text-xs text-zinc-400 border-0 bg-transparent cursor-pointer"
              />
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigateMonth(1)}>
              <ChevronRight className="w-4 h-4" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handlePrintCommission}
              disabled={!commissionData || commissionData.mechanics.length === 0}
              className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50 ml-2"
            >
              <Printer className="w-4 h-4" />
              Imprimir
            </Button>
          </div>

          {commissionLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
            </div>
          ) : commissionData && commissionData.mechanics.length > 0 ? (
            <div className="space-y-4">
              {/* Grand Totals */}
              <div className="grid grid-cols-3 gap-3">
                <Card className="border-emerald-200 bg-emerald-50/50">
                  <CardContent className="pt-4 pb-4 text-center">
                    <p className="text-xs text-emerald-600 mb-1">Total Serviços</p>
                    <p className="text-xl font-bold text-emerald-700">{commissionData.totals.totalServices}</p>
                  </CardContent>
                </Card>
                <Card className="border-blue-200 bg-blue-50/50">
                  <CardContent className="pt-4 pb-4 text-center">
                    <p className="text-xs text-blue-600 mb-1">Valor Total</p>
                    <p className="text-xl font-bold text-blue-700">{formatCurrency(commissionData.totals.totalValue)}</p>
                  </CardContent>
                </Card>
                <Card className="border-amber-200 bg-amber-50/50">
                  <CardContent className="pt-4 pb-4 text-center">
                    <p className="text-xs text-amber-600 mb-1">Total Comissões</p>
                    <p className="text-xl font-bold text-amber-700">{formatCurrency(commissionData.totals.totalCommission)}</p>
                  </CardContent>
                </Card>
              </div>

              {/* Per Mechanic Report */}
              {commissionData.mechanics.map((report) => (
                <Card key={report.mechanic.id} className="border-zinc-200/60">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center">
                          <User className="w-4 h-4 text-emerald-600" />
                        </div>
                        <div>
                          <CardTitle className="text-base">{report.mechanic.name}</CardTitle>
                          <div className="flex items-center gap-2 mt-0.5">
                            {report.mechanic.specialty && (
                              <span className="text-xs text-zinc-400">
                                {specialtyLabels[report.mechanic.specialty] || report.mechanic.specialty}
                              </span>
                            )}
                            <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 text-[10px]">
                              {report.mechanic.commissionPct}% comissão
                            </Badge>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-emerald-700">{formatCurrency(report.totalCommission)}</p>
                        <p className="text-[10px] text-zinc-400">
                          {report.totalServices} serviço(s) · {formatCurrency(report.totalValue)}
                        </p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    {report.items.length > 0 ? (
                      <div className="space-y-2">
                        {report.items.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between p-2.5 rounded-lg bg-zinc-50 text-sm"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-zinc-800 truncate">{item.description}</p>
                              <p className="text-xs text-zinc-400">
                                OS {item.serviceOrder.number} · {item.serviceOrder.client.name} · {item.serviceOrder.vehicle.plate}
                              </p>
                            </div>
                            <div className="text-right ml-4 shrink-0">
                              <p className="font-medium text-zinc-700">{formatCurrency(item.totalPrice)}</p>
                              <p className="text-xs text-emerald-600 font-semibold">
                                {item.commissionPct}% = {formatCurrency(item.commissionValue)}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-zinc-400 text-center py-4">
                        Nenhum serviço finalizado neste período
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="py-10 text-center">
              <FileText className="w-12 h-12 text-zinc-300 mx-auto mb-3" />
              <p className="text-zinc-500 text-sm">
                Nenhum serviço finalizado encontrado para este período
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
