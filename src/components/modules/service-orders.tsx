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
import { Separator } from '@/components/ui/separator'
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Loader2,
  FileText,
  Play,
  CheckCircle,
  CreditCard,
  XCircle,
  ArrowLeft,
  Wrench,
  Package,
  Printer,
  User,
  DollarSign,
  AlertTriangle,
  ArrowDownCircle,
  MessageCircle,
} from 'lucide-react'
import OSReceipt from '@/components/modules/os-receipt'
import { ClientInvoiceDoc, type ClientInvoiceData } from '@/components/modules/client-invoice-doc'

// =============================================
// TYPES
// =============================================
type OSStatus = 'ABERTA' | 'EM_EXECUCAO' | 'FINALIZADA' | 'PAGA' | 'CANCELADA'

interface ClientSimple {
  id: string
  name: string
  cpfCnpj?: string | null
  phone?: string | null
}

interface VehicleSimple {
  id: string
  plate: string
  brand?: string | null
  model?: string | null
  year?: number | null
  color?: string | null
}

interface PartSimple {
  id: string
  sku: string
  description: string
  salePrice: number
  quantity: number
}

interface MechanicSimple {
  id: string
  name: string
  specialty?: string | null
  commissionPct: number
  active: boolean
}

interface ServiceOrderItem {
  id?: string
  type: 'SERVICO' | 'PECA'
  description: string
  quantity: number
  unitPrice: number
  totalPrice: number
  partId?: string | null
  mechanicId?: string | null
  commissionPct?: number
  mechanic?: { id: string; name: string; commissionPct: number } | null
}

interface ServiceOrder {
  id: string
  number: string
  status: OSStatus
  description?: string | null
  diagnosis?: string | null
  totalParts: number
  totalServices: number
  totalDiscount: number
  totalAmount: number
  paymentMethod?: string | null
  paidAt?: string | null
  clientId: string
  vehicleId: string
  client: { id: string; name: string; phone?: string | null; email?: string | null }
  vehicle: VehicleSimple
  items: ServiceOrderItem[]
  createdAt: string
  updatedAt: string
  totalCommission?: number
}

// =============================================
// STATUS HELPERS
// =============================================
const STATUS_CONFIG: Record<OSStatus, { label: string; color: string; icon: typeof FileText }> = {
  ABERTA: { label: 'Aberta', color: 'bg-blue-100 text-blue-800 border-blue-200', icon: FileText },
  EM_EXECUCAO: { label: 'Em Execução', color: 'bg-yellow-100 text-yellow-800 border-yellow-200', icon: Play },
  FINALIZADA: { label: 'Finalizada', color: 'bg-green-100 text-green-800 border-green-200', icon: CheckCircle },
  PAGA: { label: 'Paga', color: 'bg-emerald-100 text-emerald-800 border-emerald-200', icon: CreditCard },
  CANCELADA: { label: 'Cancelada', color: 'bg-red-100 text-red-800 border-red-200', icon: XCircle },
}

const STATUS_FLOW: OSStatus[] = ['ABERTA', 'EM_EXECUCAO', 'FINALIZADA', 'PAGA']

function StatusBadge({ status }: { status: OSStatus }) {
  const config = STATUS_CONFIG[status]
  return (
    <Badge variant="outline" className={`${config.color} font-medium`}>
      {config.label}
    </Badge>
  )
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

// =============================================
// STATUS TIMELINE
// =============================================
function StatusTimeline({ status }: { status: OSStatus }) {
  const currentIndex = STATUS_FLOW.indexOf(status)
  const isCancelled = status === 'CANCELADA'

  return (
    <div className="flex items-center justify-between w-full">
      {STATUS_FLOW.map((step, index) => {
        const config = STATUS_CONFIG[step]
        const isCompleted = !isCancelled && index <= currentIndex
        const isCurrent = !isCancelled && index === currentIndex
        const Icon = config.icon

        return (
          <div key={step} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 transition-all ${
                  isCompleted
                    ? 'bg-emerald-600 border-emerald-600 text-white'
                    : isCancelled
                    ? 'bg-zinc-100 border-zinc-300 text-zinc-400'
                    : 'bg-white border-zinc-300 text-zinc-400'
                } ${isCurrent ? 'ring-4 ring-emerald-100' : ''}`}
              >
                <Icon className="w-4 h-4" />
              </div>
              <span
                className={`text-xs font-medium ${
                  isCompleted ? 'text-emerald-700' : isCancelled ? 'text-zinc-400' : 'text-zinc-400'
                }`}
              >
                {config.label}
              </span>
            </div>
            {index < STATUS_FLOW.length - 1 && (
              <div
                className={`flex-1 h-0.5 mx-2 rounded-full transition-all ${
                  !isCancelled && index < currentIndex ? 'bg-emerald-600' : 'bg-zinc-200'
                }`}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// =============================================
// NEW/EDIT OS DIALOG
// =============================================
function OSFormDialog({
  open,
  onClose,
  onSave,
  editingOS,
}: {
  open: boolean
  onClose: () => void
  onSave: (data: Record<string, unknown>) => Promise<void>
  editingOS: ServiceOrder | null
}) {
  const { user } = useAuthStore()
  const officeId = user?.officeId || ''

  const [clients, setClients] = useState<ClientSimple[]>([])
  const [vehicles, setVehicles] = useState<VehicleSimple[]>([])
  const [parts, setParts] = useState<PartSimple[]>([])
  const [mechanics, setMechanics] = useState<MechanicSimple[]>([])
  const [loading, setLoading] = useState(false)
  const [clientsLoading, setClientsLoading] = useState(false)
  const [clientSearch, setClientSearch] = useState('')

  const [selectedClientId, setSelectedClientId] = useState('')
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [description, setDescription] = useState('')
  const [diagnosis, setDiagnosis] = useState('')
  const [discount, setDiscount] = useState(0)
  const [discountType, setDiscountType] = useState<'VALUE' | 'PERCENT'>('VALUE')
  const [items, setItems] = useState<ServiceOrderItem[]>([
    { type: 'SERVICO', description: '', quantity: 1, unitPrice: 0, totalPrice: 0, partId: null, mechanicId: null, commissionPct: 0 },
  ])

  // Fetch clients
  useEffect(() => {
    if (!open) return
    const fetchClients = async () => {
      setClientsLoading(true)
      try {
        const res = await apiFetch(`/api/clients?officeId=${officeId}&limit=100`)
        if (res.success) setClients(res.data)
      } catch (err) {
        console.error('Error fetching clients:', err)
      } finally {
        setClientsLoading(false)
      }
    }
    fetchClients()
  }, [open, officeId])

  // Fetch parts
  useEffect(() => {
    if (!open) return
    const fetchParts = async () => {
      try {
        const res = await apiFetch(`/api/parts?officeId=${officeId}`)
        if (res.success) setParts(res.data)
      } catch (err) {
        console.error('Error fetching parts:', err)
      }
    }
    fetchParts()
  }, [open, officeId])

  // Fetch mechanics (active only)
  useEffect(() => {
    if (!open) return
    const fetchMechanics = async () => {
      try {
        const res = await apiFetch(`/api/mechanics?officeId=${officeId}&active=true`)
        if (res.success) setMechanics(res.data)
      } catch (err) {
        console.error('Error fetching mechanics:', err)
      }
    }
    fetchMechanics()
  }, [open, officeId])

  // Fetch vehicles when client changes
  useEffect(() => {
    if (!selectedClientId) {
      setVehicles([])
      return
    }
    const fetchVehicles = async () => {
      try {
        const res = await apiFetch(`/api/vehicles?officeId=${officeId}&clientId=${selectedClientId}`)
        if (res.success) setVehicles(res.data)
      } catch (err) {
        console.error('Error fetching vehicles:', err)
      }
    }
    fetchVehicles()
  }, [selectedClientId, officeId])

  // Populate form when editing
  useEffect(() => {
    if (editingOS) {
      setSelectedClientId(editingOS.clientId)
      setSelectedVehicleId(editingOS.vehicleId)
      setDescription(editingOS.description || '')
      setDiagnosis(editingOS.diagnosis || '')
      setDiscount(editingOS.totalDiscount)
      setDiscountType('VALUE')
      setItems(
        editingOS.items.map((item) => ({
          id: item.id,
          type: item.type as 'SERVICO' | 'PECA',
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          partId: item.partId || null,
          mechanicId: item.mechanicId || null,
          commissionPct: item.commissionPct || 0,
        }))
      )
    } else {
      setSelectedClientId('')
      setSelectedVehicleId('')
      setDescription('')
      setDiagnosis('')
      setDiscount(0)
      setDiscountType('VALUE')
      setItems([
        { type: 'SERVICO', description: '', quantity: 1, unitPrice: 0, totalPrice: 0, partId: null, mechanicId: null, commissionPct: 0 },
      ])
    }
  }, [editingOS, open])

  const addItem = (type: 'SERVICO' | 'PECA' = 'SERVICO') => {
    if (type === 'PECA') {
      setItems([...items, { type: 'PECA', description: '', quantity: 1, unitPrice: 0, totalPrice: 0, partId: null, mechanicId: null, commissionPct: 0 }])
    } else {
      setItems([...items, { type: 'SERVICO', description: '', quantity: 1, unitPrice: 0, totalPrice: 0, partId: null, mechanicId: null, commissionPct: 0 }])
    }
  }

  const removeItem = (index: number) => {
    if (items.length <= 1) return
    setItems(items.filter((_, i) => i !== index))
  }

  const updateItem = (index: number, field: string, value: string | number | null) => {
    const updated = [...items]
    updated[index] = { ...updated[index], [field]: value }

    if (field === 'quantity' || field === 'unitPrice') {
      const qty = field === 'quantity' ? Number(value) : updated[index].quantity
      const price = field === 'unitPrice' ? Number(value) : updated[index].unitPrice
      updated[index].totalPrice = qty * price
    }

    // Auto-fill from part selection
    if (field === 'partId' && value) {
      const part = parts.find((p) => p.id === value)
      if (part) {
        updated[index].description = part.description
        updated[index].unitPrice = part.salePrice
        updated[index].totalPrice = updated[index].quantity * part.salePrice
      }
    }

    // Auto-fill commission when mechanic is selected
    if (field === 'mechanicId') {
      if (value) {
        const mechanic = mechanics.find((m) => m.id === value)
        if (mechanic) {
          updated[index].commissionPct = mechanic.commissionPct
        }
      } else {
        updated[index].commissionPct = 0
      }
    }

    setItems(updated)
  }

  const totalParts = items.filter((i) => i.type === 'PECA').reduce((sum, i) => sum + i.totalPrice, 0)
  const totalServices = items.filter((i) => i.type === 'SERVICO').reduce((sum, i) => sum + i.totalPrice, 0)
  const subtotal = totalParts + totalServices
  const discountValue = discountType === 'PERCENT' ? (subtotal * discount) / 100 : discount
  const totalAmount = Math.max(0, subtotal - discountValue)

  const filteredClients = clients.filter((c) =>
    !clientSearch || c.name.toLowerCase().includes(clientSearch.toLowerCase()) || (c.cpfCnpj && c.cpfCnpj.includes(clientSearch))
  )

  const handleSave = async () => {
    if (!selectedClientId || !selectedVehicleId || items.length === 0) return

    // Validate stock for PECA items
    const insufficientStock = items
      .filter((i) => i.type === 'PECA' && i.partId)
      .find((i) => {
        const part = parts.find((p) => p.id === i.partId)
        return part && part.quantity < i.quantity
      })
    if (insufficientStock) {
      const part = parts.find((p) => p.id === insufficientStock.partId)
      alert(`Estoque insuficiente para "${part?.description || 'peça'}". Disponível: ${part?.quantity || 0}, Solicitado: ${insufficientStock.quantity}`)
      return
    }

    setLoading(true)
    try {
      const payload = {
        officeId,
        clientId: selectedClientId,
        vehicleId: selectedVehicleId,
        description: description || undefined,
        diagnosis: diagnosis || undefined,
        totalDiscount: discountValue,
        items: items.map((item) => ({
          id: item.id,
          type: item.type,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          partId: item.partId || undefined,
          mechanicId: item.type === 'SERVICO' ? (item.mechanicId || undefined) : undefined,
          commissionPct: item.type === 'SERVICO' && item.mechanicId ? (item.commissionPct || 0) : undefined,
        })),
      }

      if (editingOS) {
        await apiFetch(`/api/service-orders/${editingOS.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      } else {
        await apiFetch('/api/service-orders', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }
      await onSave(payload)
      onClose()
    } catch (err) {
      console.error('Error saving OS:', err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-zinc-900">
            {editingOS ? `Editar OS ${editingOS.number}` : 'Nova Ordem de Serviço'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          {/* Client & Vehicle */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Cliente *</Label>
              <Input
                placeholder="Buscar cliente..."
                value={clientSearch}
                onChange={(e) => setClientSearch(e.target.value)}
                className="mb-1"
              />
              <Select value={selectedClientId} onValueChange={(v) => { setSelectedClientId(v); setSelectedVehicleId('') }}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={clientsLoading ? 'Carregando...' : 'Selecione o cliente'} />
                </SelectTrigger>
                <SelectContent>
                  {filteredClients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}{c.cpfCnpj ? ` - ${c.cpfCnpj}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Veículo *</Label>
              <Select value={selectedVehicleId} onValueChange={setSelectedVehicleId} disabled={!selectedClientId}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={selectedClientId ? 'Selecione o veículo' : 'Selecione o cliente primeiro'} />
                </SelectTrigger>
                <SelectContent>
                  {vehicles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.plate} - {v.brand || ''} {v.model || ''} {v.year || ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description & Diagnosis */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Descrição</Label>
              <Textarea
                placeholder="Descreva o serviço solicitado..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Diagnóstico</Label>
              <Textarea
                placeholder="Diagnóstico do veículo..."
                value={diagnosis}
                onChange={(e) => setDiagnosis(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <Separator />

          {/* Items Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold text-zinc-700">Itens da OS</Label>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => addItem('SERVICO')} className="gap-1 border-blue-200 text-blue-700 hover:bg-blue-50">
                  <Wrench className="w-3.5 h-3.5" /> Serviço
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => addItem('PECA')} className="gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
                  <Package className="w-3.5 h-3.5" /> Peça
                </Button>
              </div>
            </div>

            {/* Stock deduction info banner */}
            {items.some((i) => i.type === 'PECA' && i.partId) && (
              <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-md text-xs text-blue-700 font-medium">
                <ArrowDownCircle className="w-4 h-4 shrink-0" />
                Ao salvar a OS, as peças serão automaticamente deduzidas do estoque. Ao cancelar a OS, o estoque será estornado.
              </div>
            )}

            <div className="space-y-3">
              {items.map((item, index) => (
                <Card key={index} className={`p-3 ${item.type === 'PECA' ? 'bg-emerald-50 border-emerald-200' : 'bg-blue-50 border-blue-200'}`}>
                  <div className="flex items-center gap-2 mb-2">
                    {item.type === 'PECA' ? (
                      <Package className="w-4 h-4 text-emerald-600" />
                    ) : (
                      <Wrench className="w-4 h-4 text-blue-600" />
                    )}
                    <span className={`text-xs font-semibold ${item.type === 'PECA' ? 'text-emerald-700' : 'text-blue-700'}`}>
                      {item.type === 'PECA' ? 'Peça' : 'Serviço'}
                    </span>
                    {item.type === 'PECA' && item.partId && (
                      <span className="text-xs text-emerald-600 ml-auto">Estoque será deduzido ao salvar</span>
                    )}
                  </div>
                  <div className="grid grid-cols-12 gap-3 items-end">
                    <div className="col-span-2">
                      <Label className="text-xs text-zinc-500">Tipo</Label>
                      <Select
                        value={item.type}
                        onValueChange={(v) => updateItem(index, 'type', v)}
                      >
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="SERVICO">
                            <span className="flex items-center gap-1">
                              <Wrench className="w-3 h-3" /> Serviço
                            </span>
                          </SelectItem>
                          <SelectItem value="PECA">
                            <span className="flex items-center gap-1">
                              <Package className="w-3 h-3" /> Peça
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {item.type === 'PECA' ? (
                      <div className="col-span-3">
                        <Label className="text-xs text-zinc-500">Peça</Label>
                        <Select
                          value={item.partId || ''}
                          onValueChange={(v) => updateItem(index, 'partId', v)}
                        >
                          <SelectTrigger className={`h-9 text-xs ${item.partId && parts.find(p => p.id === item.partId) && parts.find(p => p.id === item.partId)!.quantity < item.quantity ? 'border-red-300 bg-red-50' : ''}`}>
                            <SelectValue placeholder="Selecione..." />
                          </SelectTrigger>
                          <SelectContent>
                            {parts.map((p) => (
                              <SelectItem key={p.id} value={p.id} disabled={p.quantity <= 0}>
                                <span className="flex items-center gap-1">
                                  {p.sku} - {p.description}
                                  <span className={`text-xs ml-1 ${p.quantity <= 0 ? 'text-red-500 font-bold' : p.quantity <= 5 ? 'text-amber-500' : 'text-green-600'}`}>
                                    (Est: {p.quantity})
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <div className="col-span-3">
                        <Label className="text-xs text-zinc-500">Descrição</Label>
                        <Input
                          className="h-9 text-xs"
                          placeholder="Descrição do serviço"
                          value={item.description}
                          onChange={(e) => updateItem(index, 'description', e.target.value)}
                        />
                      </div>
                    )}

                    <div className="col-span-1">
                      <Label className="text-xs text-zinc-500">Qtd</Label>
                      <Input
                        type="number"
                        className="h-9 text-xs"
                        min={1}
                        value={item.quantity}
                        onChange={(e) => updateItem(index, 'quantity', Number(e.target.value))}
                      />
                    </div>

                    <div className="col-span-2">
                      <Label className="text-xs text-zinc-500">Preço Unit.</Label>
                      <Input
                        type="number"
                        className="h-9 text-xs"
                        min={0}
                        step={0.01}
                        value={item.unitPrice}
                        onChange={(e) => updateItem(index, 'unitPrice', Number(e.target.value))}
                      />
                    </div>

                    <div className="col-span-2">
                      <Label className="text-xs text-zinc-500">Total</Label>
                      <div className="h-9 px-3 flex items-center bg-zinc-100 rounded-md border text-xs font-medium text-zinc-700">
                        {formatCurrency(item.totalPrice)}
                      </div>
                    </div>

                    <div className="col-span-2 flex items-center justify-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeItem(index)}
                        disabled={items.length <= 1}
                        className="h-9 w-9 p-0 text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Mechanic row - only for SERVICO type */}
                  {item.type === 'SERVICO' && (
                    <div className="grid grid-cols-12 gap-2 items-end mt-2 pt-2 border-t border-zinc-200">
                      <div className="col-span-4">
                        <Label className="text-xs text-zinc-500">Mecânico</Label>
                        <Select
                          value={item.mechanicId || ''}
                          onValueChange={(v) => updateItem(index, 'mechanicId', v || null)}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="Selecione o mecânico..." />
                          </SelectTrigger>
                          <SelectContent>
                            {mechanics.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.name} {m.specialty ? `(${m.specialty})` : ''} - {m.commissionPct}%
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs text-zinc-500">Comissão %</Label>
                        <Input
                          type="number"
                          className="h-9 text-xs"
                          min={0}
                          max={100}
                          step={0.5}
                          value={item.commissionPct || 0}
                          onChange={(e) => {
                            let val = parseFloat(e.target.value) || 0
                            if (val < 0) val = 0
                            if (val > 100) val = 100
                            updateItem(index, 'commissionPct', val)
                          }}
                          disabled={!item.mechanicId}
                        />
                      </div>
                      <div className="col-span-3 flex items-end">
                        {item.mechanicId && (item.commissionPct ?? 0) > 0 && (
                          <div className="h-9 px-3 flex items-center bg-emerald-50 rounded-md border border-emerald-200 text-xs font-medium text-emerald-700">
                            Comissão: {formatCurrency(item.totalPrice * ((item.commissionPct || 0) / 100))}
                          </div>
                        )}
                      </div>
                      <div className="col-span-3 flex items-end justify-end">
                        {item.mechanicId && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => updateItem(index, 'mechanicId', null)}
                            className="h-7 text-xs text-zinc-400 hover:text-red-500"
                          >
                            Remover mecânico
                          </Button>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Stock deduction indicator - only for PECA type */}
                  {item.type === 'PECA' && item.partId && (
                    <div className="mt-2 pt-2 border-t border-zinc-200">
                      {(() => {
                        const part = parts.find((p) => p.id === item.partId)
                        if (!part) return null
                        const hasStock = part.quantity >= item.quantity
                        const lowStock = part.quantity > 0 && part.quantity <= 5
                        return (
                          <div className={`flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium ${
                            hasStock
                              ? lowStock
                                ? 'bg-amber-50 border border-amber-200 text-amber-700'
                                : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                              : 'bg-red-50 border border-red-200 text-red-700'
                          }`}>
                            {!hasStock ? (
                              <>
                                <AlertTriangle className="w-3.5 h-3.5" />
                                Estoque insuficiente! Disponível: {part.quantity} un | Necessário: {item.quantity} un
                              </>
                            ) : (
                              <>
                                <ArrowDownCircle className="w-3.5 h-3.5" />
                                {lowStock ? (
                                  <>Estoque baixo! Serão deduzidas {item.quantity} un de {part.quantity} disponíveis</>
                                ) : (
                                  <>Baixa no estoque: {item.quantity} un de {part.quantity} disponíveis</>
                                )}
                              </>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </div>

          <Separator />

          {/* Totals */}
          <div className="flex flex-col items-end gap-2">
            <div className="w-full max-w-sm space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Total Peças:</span>
                <span className="font-medium">{formatCurrency(totalParts)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Total Serviços:</span>
                <span className="font-medium">{formatCurrency(totalServices)}</span>
              </div>
              <div className="flex justify-between text-sm items-center">
                <div className="flex items-center gap-2">
                  <span className="text-zinc-500">Desconto:</span>
                  <div className="flex items-center gap-0.5 bg-zinc-100 rounded-md p-0.5">
                    <button
                      type="button"
                      onClick={() => { setDiscountType('VALUE'); setDiscount(0) }}
                      className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
                        discountType === 'VALUE' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                      }`}
                    >
                      R$
                    </button>
                    <button
                      type="button"
                      onClick={() => { setDiscountType('PERCENT'); setDiscount(0) }}
                      className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
                        discountType === 'PERCENT' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                      }`}
                    >
                      %
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Input
                    type="number"
                    min={0}
                    step={discountType === 'PERCENT' ? 1 : 0.01}
                    max={discountType === 'PERCENT' ? 100 : subtotal}
                    value={discount || ''}
                    onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder={discountType === 'VALUE' ? '0,00' : '0'}
                    className="h-8 w-24 text-sm text-right"
                  />
                </div>
              </div>
              {discountType === 'PERCENT' && discount > 0 && (
                <div className="flex justify-end">
                  <p className="text-xs text-zinc-400">{discount}% = {formatCurrency(discountValue)} de desconto</p>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-base font-bold">
                <span className="text-zinc-800">Total Geral:</span>
                <span className="text-emerald-700">{formatCurrency(totalAmount)}</span>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || !selectedClientId || !selectedVehicleId || items.length === 0}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {editingOS ? 'Salvar Alterações' : 'Criar OS'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================
// PAYMENT DIALOG
// =============================================
function PaymentDialog({
  open,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (method: string) => Promise<void>
  loading: boolean
}) {
  const [method, setMethod] = useState('')

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-zinc-900">Registrar Pagamento</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-sm font-medium text-zinc-700">Forma de Pagamento *</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PIX">PIX</SelectItem>
                <SelectItem value="CARTAO">Cartão</SelectItem>
                <SelectItem value="DINHEIRO">Dinheiro</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={() => onConfirm(method)}
            disabled={loading || !method}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Confirmar Pagamento
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================
// OS DETAIL VIEW
// =============================================
function OSDetail({
  os,
  onBack,
  onStatusChange,
  onEdit,
}: {
  os: ServiceOrder
  onBack: () => void
  onStatusChange: (id: string, status: OSStatus, paymentMethod?: string) => Promise<void>
  onEdit: (os: ServiceOrder) => void
}) {
  const [statusLoading, setStatusLoading] = useState(false)
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [showReceipt, setShowReceipt] = useState(false)
  const [receiptMode, setReceiptMode] = useState<'receipt' | 'closure'>('receipt')
  const { office, user } = useAuthStore()
  const [receiptLogo, setReceiptLogo] = useState<string | null>(office?.logo || null)

  // Client Invoice state
  const [showClientInvoice, setShowClientInvoice] = useState(false)
  const [clientInvoiceData, setClientInvoiceData] = useState<ClientInvoiceData | null>(null)
  const [generatingNF, setGeneratingNF] = useState(false)

  // WhatsApp integration state
  const [waEnabled, setWaEnabled] = useState(false)
  const [waSending, setWaSending] = useState(false)
  const [waMessage, setWaMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Fetch WhatsApp config
  useEffect(() => {
    const fetchWaConfig = async () => {
      if (!office) return
      try {
        const res = await apiFetch(`/api/whatsapp/config?officeId=${office.id}`)
        if (res.success && res.data) {
          setWaEnabled(res.data.enabled && res.data.configured && res.data.hasToken)
        }
      } catch {
        // Silently handle
      }
    }
    fetchWaConfig()
  }, [office])

  const handleSendWhatsApp = async (mode: 'estimate' | 'receipt') => {
    if (!office) return
    setWaSending(true)
    setWaMessage(null)
    try {
      const res = await apiFetch('/api/whatsapp/send-os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId: office.id,
          serviceOrderId: os.id,
          mode,
        }),
      })
      if (res.success) {
        const phone = res.data?.phone || os.client.phone || ''
        setWaMessage({
          type: 'success',
          text: `${mode === 'estimate' ? 'Orçamento' : 'Recibo'} enviado via WhatsApp para ${phone}`,
        })
      } else {
        setWaMessage({
          type: 'error',
          text: res.error || 'Erro ao enviar via WhatsApp',
        })
      }
    } catch {
      setWaMessage({ type: 'error', text: 'Erro de conexão ao enviar via WhatsApp' })
    } finally {
      setWaSending(false)
      setTimeout(() => setWaMessage(null), 5000)
    }
  }

  // Resolve logo URL for API route serving
  const resolveLogoUrl = (logo: string | null | undefined): string | null => {
    if (!logo) return null
    if (logo.startsWith('http') || logo.startsWith('data:')) return logo
    return logo.replace(/^\/uploads\//, '/api/uploads/')
  }

  // Fetch fresh logo when receipt opens
  const handleOpenReceipt = async (mode: 'receipt' | 'closure') => {
    setReceiptMode(mode)
    try {
      const data = await apiFetch(`/api/auth/me`)
      if (data.success && data.data?.office?.logo) {
        setReceiptLogo(resolveLogoUrl(data.data.office.logo))
      } else {
        setReceiptLogo(resolveLogoUrl(office?.logo))
      }
    } catch {
      setReceiptLogo(resolveLogoUrl(office?.logo))
    }
    setShowReceipt(true)
  }

  const handleStatusChange = async (newStatus: OSStatus, paymentMethod?: string) => {
    setStatusLoading(true)
    try {
      await onStatusChange(os.id, newStatus, paymentMethod)
    } finally {
      setStatusLoading(false)
      setPaymentOpen(false)
    }
  }

  // Emit NF for this OS
  const handleEmitNF = async () => {
    if (!office) return
    setGeneratingNF(true)
    try {
      const res = await apiFetch('/api/client-invoices', {
        method: 'POST',
        body: JSON.stringify({
          officeId: office.id,
          type: 'SERVICO',
          serviceOrderId: os.id,
        }),
      })
      if (res.success && res.data) {
        const detailRes = await apiFetch(`/api/client-invoices/${res.data.id}?officeId=${office.id}`)
        if (detailRes.success && detailRes.data) {
          setClientInvoiceData(detailRes.data as ClientInvoiceData)
          setShowClientInvoice(true)
        }
      } else {
        alert(res.error || 'Erro ao emitir nota fiscal')
      }
    } catch {
      alert('Erro de conexão ao emitir nota fiscal')
    } finally {
      setGeneratingNF(false)
    }
  }

  const pecaItems = os.items.filter((i) => i.type === 'PECA')
  const servicoItems = os.items.filter((i) => i.type === 'SERVICO')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Button>
          <div>
            <h2 className="text-xl font-bold text-zinc-900">{os.number}</h2>
            <p className="text-sm text-zinc-500">
              Criada em {formatDate(os.createdAt)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={os.status} />
          {os.status !== 'PAGA' && os.status !== 'CANCELADA' && (
            <Button variant="outline" size="sm" onClick={() => onEdit(os)}>
              Editar
            </Button>
          )}
        </div>
      </div>

      {/* Status Timeline */}
      <Card className="p-6">
        <StatusTimeline status={os.status} />
      </Card>

      {/* Client & Vehicle Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">Cliente</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="font-semibold text-zinc-900">{os.client.name}</p>
            {os.client.phone && <p className="text-sm text-zinc-600">Tel: {os.client.phone}</p>}
            {os.client.email && <p className="text-sm text-zinc-600">{os.client.email}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">Veículo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            <p className="font-semibold text-zinc-900">
              {os.vehicle ? `${os.vehicle.brand || ''} ${os.vehicle.model || ''}`.trim() || '—' : '—'}
            </p>
            <p className="text-sm text-zinc-600">Placa: {os.vehicle?.plate || '—'}</p>
            {os.vehicle?.year && <p className="text-sm text-zinc-600">Ano: {os.vehicle.year}</p>}
            {os.vehicle?.color && <p className="text-sm text-zinc-600">Cor: {os.vehicle.color}</p>}
          </CardContent>
        </Card>
      </div>

      {/* Description & Diagnosis */}
      {(os.description || os.diagnosis) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {os.description && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">Descrição</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-700 whitespace-pre-wrap">{os.description}</p>
              </CardContent>
            </Card>
          )}
          {os.diagnosis && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">Diagnóstico</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-zinc-700 whitespace-pre-wrap">{os.diagnosis}</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Items */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">Itens</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Mecânico</TableHead>
                <TableHead className="text-right">Qtd</TableHead>
                <TableHead className="text-right">Preço Unit.</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Comissão</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {servicoItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                      <Wrench className="w-3 h-3 mr-1" /> Serviço
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-zinc-900">{item.description}</TableCell>
                  <TableCell className="text-sm text-zinc-600">
                    {item.mechanic ? (
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" /> {item.mechanic.name}
                      </span>
                    ) : '—'}
                  </TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(item.totalPrice)}</TableCell>
                  <TableCell className="text-right text-emerald-700 text-xs">
                    {item.mechanicId && item.commissionPct ? `${item.commissionPct}% = ${formatCurrency(item.totalPrice * ((item.commissionPct || 0) / 100))}` : '—'}
                  </TableCell>
                </TableRow>
              ))}
              {pecaItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-xs">
                      <Package className="w-3 h-3 mr-1" /> Peça
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium text-zinc-900">
                    {item.description}
                    <span className="ml-2 text-xs text-emerald-600 inline-flex items-center gap-0.5">
                      <ArrowDownCircle className="w-3 h-3" /> Baixa estoque
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-zinc-600">—</TableCell>
                  <TableCell className="text-right">{item.quantity}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(item.totalPrice)}</TableCell>
                  <TableCell className="text-right">—</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Totals */}
          <div className="mt-4 flex justify-end">
            <div className="w-full max-w-xs space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Total Serviços:</span>
                <span className="font-medium">{formatCurrency(os.totalServices)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Total Peças:</span>
                <span className="font-medium">{formatCurrency(os.totalParts)}</span>
              </div>
              {os.totalDiscount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Desconto:</span>
                  <span className="font-medium text-red-600">-{formatCurrency(os.totalDiscount)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-base font-bold">
                <span className="text-zinc-800">Total:</span>
                <span className="text-emerald-700">{formatCurrency(os.totalAmount)}</span>
              </div>
              {/* Commission total */}
              {os.items.some((i: ServiceOrderItem) => i.mechanicId && i.commissionPct && i.commissionPct > 0) && (
                <>
                  <Separator />
                  <div className="flex justify-between text-sm">
                    <span className="text-emerald-600 flex items-center gap-1">
                      <DollarSign className="w-3.5 h-3.5" /> Total Comissões:
                    </span>
                    <span className="font-semibold text-emerald-700">
                      {formatCurrency(
                        os.items
                          .filter((i: ServiceOrderItem) => i.type === 'SERVICO' && i.mechanicId && i.commissionPct)
                          .reduce((sum: number, i: ServiceOrderItem) => sum + (i.totalPrice * ((i.commissionPct || 0) / 100)), 0)
                      )}
                    </span>
                  </div>
                </>
              )}
              {os.paymentMethod && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Pagamento:</span>
                  <span className="font-medium text-zinc-700">
                    {os.paymentMethod === 'PIX' ? 'PIX' : os.paymentMethod === 'CARTAO' ? 'Cartão' : 'Dinheiro'}
                  </span>
                </div>
              )}
              {os.paidAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Pago em:</span>
                  <span className="font-medium text-zinc-700">{formatDate(os.paidAt)}</span>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-3">
        {os.status === 'ABERTA' && (
          <Button
            onClick={() => handleStatusChange('EM_EXECUCAO')}
            disabled={statusLoading}
            className="bg-yellow-500 hover:bg-yellow-600 text-white gap-2"
          >
            {statusLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Iniciar Execução
          </Button>
        )}
        {os.status === 'EM_EXECUCAO' && (
          <Button
            onClick={() => handleStatusChange('FINALIZADA')}
            disabled={statusLoading}
            className="bg-green-600 hover:bg-green-700 text-white gap-2"
          >
            {statusLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
            Finalizar
          </Button>
        )}
        {os.status === 'FINALIZADA' && (
          <Button
            onClick={() => setPaymentOpen(true)}
            disabled={statusLoading}
            className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
          >
            {statusLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CreditCard className="w-4 h-4" />}
            Registrar Pagamento
          </Button>
        )}
        {os.status !== 'CANCELADA' && os.status !== 'PAGA' && (
          <Button
            variant="outline"
            onClick={() => handleStatusChange('CANCELADA')}
            disabled={statusLoading}
            className="text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200 gap-2"
          >
            <XCircle className="w-4 h-4" /> Cancelar OS
          </Button>
        )}
        {/* Print Buttons */}
        <Button
          variant="outline"
          onClick={() => handleOpenReceipt('closure')}
          className="border-zinc-300 text-zinc-700 hover:bg-zinc-50 gap-2"
        >
          <Printer className="w-4 h-4" /> Imprimir OS
        </Button>
        {os.status === 'PAGA' && (
          <Button
            variant="outline"
            onClick={() => handleOpenReceipt('receipt')}
            className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 gap-2"
          >
            <Printer className="w-4 h-4" /> Recibo de Pagamento
          </Button>
        )}
        {os.status === 'PAGA' && (
          <Button
            variant="outline"
            onClick={handleEmitNF}
            disabled={generatingNF}
            className="border-amber-300 text-amber-700 hover:bg-amber-50 gap-2"
          >
            {generatingNF ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Emitir Nota Fiscal
          </Button>
        )}

        {/* WhatsApp Buttons */}
        {waEnabled && (
          <>
            <Button
              variant="outline"
              onClick={() => handleSendWhatsApp('estimate')}
              disabled={waSending}
              className="border-green-300 text-green-700 hover:bg-green-50 gap-2"
            >
              {waSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
              Enviar Orçamento
            </Button>
            {os.status === 'PAGA' && (
              <Button
                variant="outline"
                onClick={() => handleSendWhatsApp('receipt')}
                disabled={waSending}
                className="border-green-300 text-green-700 hover:bg-green-50 gap-2"
              >
                {waSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
                Enviar Recibo
              </Button>
            )}
          </>
        )}
      </div>

      {/* WhatsApp Message */}
      {waMessage && (
        <div className={`p-3 rounded-lg text-sm flex items-center gap-2 ${
          waMessage.type === 'success'
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {waMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {waMessage.text}
        </div>
      )}

      {/* Payment Dialog */}
      <PaymentDialog
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        onConfirm={(method) => handleStatusChange('PAGA', method)}
        loading={statusLoading}
      />

      {/* Receipt Modal */}
      <Dialog open={showReceipt} onOpenChange={setShowReceipt}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold text-zinc-900">
              {receiptMode === 'receipt' ? 'Recibo de Pagamento' : 'Ordem de Serviço'}
            </DialogTitle>
          </DialogHeader>
          {office && (
            <OSReceipt
              os={os}
              office={{
                name: office.name,
                cnpj: office.cnpj,
                email: office.email,
                phone: office.phone,
                address: office.address,
                city: office.city,
                state: office.state,
                logo: receiptLogo,
              }}
              mode={receiptMode}
              onClose={() => setShowReceipt(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Client Invoice Modal */}
      <Dialog open={showClientInvoice} onOpenChange={setShowClientInvoice}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nota Fiscal de Serviço</DialogTitle>
          </DialogHeader>
          {clientInvoiceData && (
            <ClientInvoiceDoc
              invoice={clientInvoiceData}
              onClose={() => setShowClientInvoice(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// =============================================
// MAIN COMPONENT
// =============================================
export function ServiceOrdersModule() {
  const { user } = useAuthStore()
  const officeId = user?.officeId || ''

  const [orders, setOrders] = useState<ServiceOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const limit = 10

  const [selectedOS, setSelectedOS] = useState<ServiceOrder | null>(null)
  const [editingOS, setEditingOS] = useState<ServiceOrder | null>(null)
  const [formOpen, setFormOpen] = useState(false)

  const fetchOrders = useCallback(async () => {
    if (!officeId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ officeId })
      if (statusFilter && statusFilter !== 'all') params.set('status', statusFilter)
      if (search) params.set('search', search)
      params.set('page', String(page))
      params.set('limit', String(limit))

      const res = await apiFetch(`/api/service-orders?${params.toString()}`)
      if (res.success) {
        setOrders(res.data)
        const total = res.data.length
        setTotalPages(Math.max(1, Math.ceil(total / limit)))
      }
    } catch (err) {
      console.error('Error fetching service orders:', err)
    } finally {
      setLoading(false)
    }
  }, [officeId, statusFilter, search, page])

  useEffect(() => {
    fetchOrders()
  }, [fetchOrders])

  const handleStatusChange = async (id: string, newStatus: OSStatus, paymentMethod?: string) => {
    try {
      const res = await apiFetch(`/api/service-orders/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: newStatus, paymentMethod }),
      })
      if (res.success) {
        await fetchOrders()
        // Refresh detail view
        const detailRes = await apiFetch(`/api/service-orders/${id}`)
        if (detailRes.success) setSelectedOS(detailRes.data)
      }
    } catch (err) {
      console.error('Error changing status:', err)
    }
  }

  const handleSaveOS = async () => {
    await fetchOrders()
  }

  const handleEdit = (os: ServiceOrder) => {
    setEditingOS(os)
    setFormOpen(true)
  }

  // Detail view
  if (selectedOS) {
    return (
      <div className="p-4 md:p-6">
        <OSDetail
          os={selectedOS}
          onBack={() => setSelectedOS(null)}
          onStatusChange={handleStatusChange}
          onEdit={handleEdit}
        />
        <OSFormDialog
          open={formOpen}
          onClose={() => { setFormOpen(false); setEditingOS(null) }}
          onSave={handleSaveOS}
          editingOS={editingOS}
        />
      </div>
    )
  }

  // List view
  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Ordens de Serviço</h1>
          <p className="text-sm text-zinc-500">Gerencie as ordens de serviço da oficina</p>
        </div>
        <Button
          onClick={() => { setEditingOS(null); setFormOpen(true) }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          <Plus className="w-4 h-4" /> Nova OS
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Filtrar status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas</SelectItem>
            <SelectItem value="ABERTA">Aberta</SelectItem>
            <SelectItem value="EM_EXECUCAO">Em Execução</SelectItem>
            <SelectItem value="FINALIZADA">Finalizada</SelectItem>
            <SelectItem value="PAGA">Paga</SelectItem>
            <SelectItem value="CANCELADA">Cancelada</SelectItem>
          </SelectContent>
        </Select>
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <Input
            placeholder="Buscar por nº OS, cliente, veículo..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="pl-9"
          />
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
              <span className="ml-3 text-zinc-500">Carregando ordens...</span>
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
              <FileText className="w-12 h-12 mb-3" />
              <p className="text-lg font-medium">Nenhuma ordem encontrada</p>
              <p className="text-sm">Crie uma nova ordem de serviço para começar</p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nº OS</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Veículo</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((os) => (
                      <TableRow
                        key={os.id}
                        className="cursor-pointer hover:bg-emerald-50/50"
                        onClick={() => setSelectedOS(os)}
                      >
                        <TableCell className="font-medium text-zinc-900">{os.number}</TableCell>
                        <TableCell>{os.client.name}</TableCell>
                        <TableCell>
                          <span className="font-medium">{os.vehicle?.plate || '—'}</span>
                          <span className="text-zinc-500 ml-1">
                            {os.vehicle ? `${os.vehicle.brand || ''} ${os.vehicle.model || ''}`.trim() : '—'}
                          </span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={os.status as OSStatus} />
                        </TableCell>
                        <TableCell className="text-right font-medium text-emerald-700">
                          {formatCurrency(os.totalAmount)}
                        </TableCell>
                        <TableCell className="text-zinc-500">{formatDate(os.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden divide-y">
                {orders.map((os) => (
                  <div
                    key={os.id}
                    className="p-4 cursor-pointer hover:bg-emerald-50/50 transition-colors"
                    onClick={() => setSelectedOS(os)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-zinc-900">{os.number}</span>
                      <StatusBadge status={os.status as OSStatus} />
                    </div>
                    <p className="text-sm text-zinc-700">{os.client.name}</p>
                    <p className="text-xs text-zinc-500">
                      {os.vehicle ? `${os.vehicle.plate} - ${os.vehicle.brand || ''} ${os.vehicle.model || ''}` : '—'}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-xs text-zinc-400">{formatDate(os.createdAt)}</span>
                      <span className="font-semibold text-emerald-700">{formatCurrency(os.totalAmount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm text-zinc-600">
            Página {page} de {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      )}

      {/* New/Edit Dialog */}
      <OSFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingOS(null) }}
        onSave={handleSaveOS}
        editingOS={editingOS}
      />
    </div>
  )
}
