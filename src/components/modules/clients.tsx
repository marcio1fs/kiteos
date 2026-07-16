'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { maskCPFCNPJ, validateCPFCNPJ, formatCPFCNPJ, maskPhone } from '@/lib/validators'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
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
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Users,
  Phone,
  Mail,
  MapPin,
  Car,
  ArrowLeft,
  Pencil,
  Trash2,
  FileText,
  SearchCheck,
} from 'lucide-react'

// =============================================
// TYPES
// =============================================
interface VehicleData {
  id: string
  plate: string
  brand?: string | null
  model?: string | null
  year?: number | null
  color?: string | null
  km?: number | null
  chassi?: string | null
}

interface ServiceOrderSimple {
  id: string
  number: string
  status: string
  totalAmount: number
  createdAt: string
  vehicle: { plate: string; brand?: string | null; model?: string | null }
}

interface ClientData {
  id: string
  name: string
  cpfCnpj?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
  createdAt: string
  vehicles: VehicleData[]
  serviceOrders?: ServiceOrderSimple[]
}

// =============================================
// FORMAT HELPERS
// =============================================

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11) {
    return digits.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  }
  if (digits.length === 10) {
    return digits.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
  }
  return phone
}

function showToast(message: string, type: 'success' | 'error' = 'error') {
  // Simple toast using a div
  const existing = document.getElementById('kiteos-toast')
  if (existing) existing.remove()
  const toast = document.createElement('div')
  toast.id = 'kiteos-toast'
  toast.className = `fixed top-4 right-4 z-[9999] px-4 py-3 rounded-lg shadow-lg text-sm font-medium transition-all ${
    type === 'error'
      ? 'bg-red-600 text-white'
      : 'bg-emerald-600 text-white'
  }`
  toast.textContent = message
  document.body.appendChild(toast)
  setTimeout(() => toast.remove(), 4000)
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

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  ABERTA: { label: 'Aberta', color: 'bg-blue-100 text-blue-800 border-blue-200' },
  EM_EXECUCAO: { label: 'Em Execução', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  FINALIZADA: { label: 'Finalizada', color: 'bg-green-100 text-green-800 border-green-200' },
  PAGA: { label: 'Paga', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  CANCELADA: { label: 'Cancelada', color: 'bg-red-100 text-red-800 border-red-200' },
}

// =============================================
// CLIENT FORM DIALOG
// =============================================
function ClientFormDialog({
  open,
  onClose,
  onSave,
  editingClient,
}: {
  open: boolean
  onClose: () => void
  onSave: (data: Record<string, unknown>) => Promise<void>
  editingClient: ClientData | null
}) {
  const [name, setName] = useState('')
  const [cpfCnpj, setCpfCnpj] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [lookingUpCNPJ, setLookingUpCNPJ] = useState(false)
  const [lookingUpCEP, setLookingUpCEP] = useState(false)
  const [lookupSuccess, setLookupSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (editingClient) {
      setName(editingClient.name)
      setCpfCnpj(editingClient.cpfCnpj || '')
      setEmail(editingClient.email || '')
      setPhone(editingClient.phone || '')
      setAddress(editingClient.address || '')
      setCity(editingClient.city || '')
      setState(editingClient.state || '')
      setZipCode(editingClient.zipCode || '')
    } else {
      setName('')
      setCpfCnpj('')
      setEmail('')
      setPhone('')
      setAddress('')
      setCity('')
      setState('')
      setZipCode('')
    }
    setErrorMsg('')
    setLookupSuccess(null)
  }, [editingClient, open])

  /** Busca automática por CNPJ na BrasilAPI */
  const handleLookupCNPJ = async () => {
    const digits = cpfCnpj.replace(/\D/g, '')
    if (digits.length !== 14) return // Só busca para CNPJ

    setLookingUpCNPJ(true)
    setLookupSuccess(null)
    try {
      const res = await apiFetch(`/api/consulta/cnpj?cnpj=${digits}`)
      if (res.success && res.data) {
        const d = res.data
        if (d.razaoSocial && !name.trim()) setName(d.razaoSocial)
        if (d.nomeFantasia && !name.trim()) setName(d.nomeFantasia)
        if (d.email && !email.trim()) setEmail(d.email)
        if (d.telefone && !phone.trim()) {
          const phoneDigits = d.telefone.replace(/\D/g, '')
          if (phoneDigits.length >= 10) setPhone(maskPhone(phoneDigits))
        }
        if (d.address && !address.trim()) setAddress(d.address)
        if (d.city && !city.trim()) setCity(d.city)
        if (d.state && !state.trim()) setState(d.state)
        if (d.zipCode && !zipCode.trim()) setZipCode(d.zipCode)
        setLookupSuccess('CNPJ')
      } else if (!res.success) {
        showToast(res.error || 'CNPJ não encontrado', 'error')
      }
    } catch {
      showToast('Erro ao buscar CNPJ', 'error')
    } finally {
      setLookingUpCNPJ(false)
    }
  }

  /** Busca automática por CEP na BrasilAPI */
  const handleLookupCEP = async () => {
    const digits = zipCode.replace(/\D/g, '')
    if (digits.length !== 8) return

    setLookingUpCEP(true)
    setLookupSuccess(null)
    try {
      const res = await apiFetch(`/api/consulta/cep?cep=${digits}`)
      if (res.success && res.data) {
        const d = res.data
        if (d.address && !address.trim()) setAddress(d.address)
        if (d.city && !city.trim()) setCity(d.city)
        if (d.state && !state.trim()) setState(d.state)
        setLookupSuccess('CEP')
      } else if (!res.success) {
        showToast(res.error || 'CEP não encontrado', 'error')
      }
    } catch {
      showToast('Erro ao buscar CEP', 'error')
    } finally {
      setLookingUpCEP(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setErrorMsg('Nome é obrigatório')
      return
    }
    // Validate CPF/CNPJ
    const cpfCnpjError = validateCPFCNPJ(cpfCnpj)
    if (cpfCnpjError) {
      setErrorMsg(cpfCnpjError)
      return
    }
    setErrorMsg('')
    setLoading(true)
    try {
      const payload = {
        name: name.trim(),
        cpfCnpj: cpfCnpj.replace(/\D/g, '') || null,
        email: email.trim() || null,
        phone: phone.replace(/\D/g, '') || null,
        address: address.trim() || null,
        city: city.trim() || null,
        state: state.trim() || null,
        zipCode: zipCode.trim() || null,
      }

      let res
      if (editingClient) {
        res = await apiFetch(`/api/clients/${editingClient.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      } else {
        const { user } = useAuthStore.getState()
        res = await apiFetch('/api/clients', {
          method: 'POST',
          body: JSON.stringify({ ...payload, officeId: user?.officeId }),
        })
      }

      if (res.success) {
        showToast(editingClient ? 'Cliente atualizado com sucesso!' : 'Cliente criado com sucesso!', 'success')
        await onSave(payload)
        onClose()
      } else {
        setErrorMsg(res.error || 'Erro ao salvar cliente')
        showToast(res.error || 'Erro ao salvar cliente', 'error')
      }
    } catch (err) {
      console.error('Error saving client:', err)
      const msg = 'Erro de conexão ao salvar cliente'
      setErrorMsg(msg)
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-zinc-900">
            {editingClient ? 'Editar Cliente' : 'Novo Cliente'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {errorMsg}
            </div>
          )}

          <div className="space-y-2">
            <Label className="text-sm font-medium text-zinc-700">Nome *</Label>
            <Input
              placeholder="Nome completo"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">CPF/CNPJ</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="000.000.000-00 ou 00.000.000/0000-00"
                  value={cpfCnpj}
                  onChange={(e) => {
                    setCpfCnpj(maskCPFCNPJ(e.target.value))
                    setLookupSuccess(null)
                  }}
                  onBlur={() => {
                    const digits = cpfCnpj.replace(/\D/g, '')
                    if (digits.length === 14) handleLookupCNPJ()
                  }}
                  maxLength={18}
                  className="flex-1"
                />
                {cpfCnpj.replace(/\D/g, '').length === 14 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleLookupCNPJ}
                    disabled={lookingUpCNPJ}
                    className="border-blue-200 text-blue-700 hover:bg-blue-50 gap-1 shrink-0"
                    title="Buscar dados do CNPJ"
                  >
                    {lookingUpCNPJ ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchCheck className="w-4 h-4" />}
                  </Button>
                )}
              </div>
              {lookupSuccess === 'CNPJ' && (
                <p className="text-xs text-emerald-600 flex items-center gap-1">
                  <SearchCheck className="w-3 h-3" /> Dados preenchidos automaticamente
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Telefone</Label>
              <Input
                placeholder="(71) 99999-9999"
                value={phone}
                onChange={(e) => setPhone(maskPhone(e.target.value))}
                maxLength={15}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-zinc-700">E-mail</Label>
            <Input
              type="email"
              placeholder="email@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-zinc-700">Endereço</Label>
            <Input
              placeholder="Rua, número, complemento"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Cidade</Label>
              <Input
                placeholder="Cidade"
                value={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Estado</Label>
              <Input
                placeholder="UF"
                maxLength={2}
                value={state}
                onChange={(e) => setState(e.target.value.toUpperCase())}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">CEP</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="00000-000"
                  value={zipCode}
                  onChange={(e) => {
                    setZipCode(e.target.value)
                    if (lookupSuccess === 'CEP') setLookupSuccess(null)
                  }}
                  onBlur={() => {
                    const digits = zipCode.replace(/\D/g, '')
                    if (digits.length === 8 && !address.trim()) handleLookupCEP()
                  }}
                  className="flex-1"
                />
                {zipCode.replace(/\D/g, '').length === 8 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleLookupCEP}
                    disabled={lookingUpCEP}
                    className="border-blue-200 text-blue-700 hover:bg-blue-50 gap-1 shrink-0"
                    title="Buscar endereço pelo CEP"
                  >
                    {lookingUpCEP ? <Loader2 className="w-4 h-4 animate-spin" /> : <SearchCheck className="w-4 h-4" />}
                  </Button>
                )}
              </div>
              {lookupSuccess === 'CEP' && (
                <p className="text-xs text-emerald-600 flex items-center gap-1">
                  <SearchCheck className="w-3 h-3" /> Endereço preenchido pelo CEP
                </p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || !name.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {editingClient ? 'Salvar Alterações' : 'Criar Cliente'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================
// VEHICLE FORM DIALOG
// =============================================
function VehicleFormDialog({
  open,
  onClose,
  onSave,
  clientId,
  editingVehicle,
}: {
  open: boolean
  onClose: () => void
  onSave: (data: Record<string, unknown>) => Promise<void>
  clientId: string
  editingVehicle: VehicleData | null
}) {
  const { user } = useAuthStore()
  const [plate, setPlate] = useState('')
  const [brand, setBrand] = useState('')
  const [model, setModel] = useState('')
  const [year, setYear] = useState('')
  const [color, setColor] = useState('')
  const [km, setKm] = useState('')
  const [chassi, setChassi] = useState('')
  const [loading, setLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [lookingUpPlaca, setLookingUpPlaca] = useState(false)
  const [lookupSuccess, setLookupSuccess] = useState(false)

  useEffect(() => {
    if (editingVehicle) {
      setPlate(editingVehicle.plate)
      setBrand(editingVehicle.brand || '')
      setModel(editingVehicle.model || '')
      setYear(editingVehicle.year?.toString() || '')
      setColor(editingVehicle.color || '')
      setKm(editingVehicle.km?.toString() || '')
      setChassi(editingVehicle.chassi || '')
    } else {
      setPlate('')
      setBrand('')
      setModel('')
      setYear('')
      setColor('')
      setKm('')
      setChassi('')
    }
    setErrorMsg('')
    setLookupSuccess(false)
  }, [editingVehicle, open])

  /** Busca automática por Placa na BrasilAPI */
  const handleLookupPlaca = async () => {
    const cleanPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (!cleanPlate || (cleanPlate.length !== 7 && cleanPlate.length !== 8)) return

    setLookingUpPlaca(true)
    setLookupSuccess(false)
    try {
      const res = await apiFetch(`/api/consulta/placa?placa=${cleanPlate}`)
      if (res.success && res.data) {
        const d = res.data
        if (d.brand && !brand.trim()) setBrand(d.brand)
        if (d.model && !model.trim()) setModel(d.model)
        if (d.year && !year.trim()) setYear(String(d.year))
        if (d.color && !color.trim()) setColor(d.color)
        if (d.chassi && !chassi.trim()) setChassi(d.chassi)
        setLookupSuccess(true)
      } else if (!res.success) {
        showToast(res.error || 'Placa não encontrada', 'error')
      }
    } catch {
      showToast('Erro ao buscar placa', 'error')
    } finally {
      setLookingUpPlaca(false)
    }
  }

  const handleSave = async () => {
    if (!plate.trim()) {
      setErrorMsg('Placa é obrigatória')
      return
    }
    if (!clientId) {
      setErrorMsg('Selecione um cliente para vincular o veículo')
      return
    }
    setErrorMsg('')
    setLoading(true)
    try {
      const payload = {
        plate: plate.toUpperCase().trim(),
        brand: brand.trim() || null,
        model: model.trim() || null,
        year: year ? parseInt(year) : null,
        color: color.trim() || null,
        km: km ? parseInt(km) : null,
        chassi: chassi.trim() || null,
        clientId,
        officeId: user?.officeId,
      }

      let res
      if (editingVehicle) {
        res = await apiFetch(`/api/vehicles/${editingVehicle.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        })
      } else {
        res = await apiFetch('/api/vehicles', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
      }

      if (res.success) {
        showToast(editingVehicle ? 'Veículo atualizado com sucesso!' : 'Veículo adicionado com sucesso!', 'success')
        await onSave(payload)
        onClose()
      } else {
        setErrorMsg(res.error || 'Erro ao salvar veículo')
        showToast(res.error || 'Erro ao salvar veículo', 'error')
      }
    } catch (err) {
      console.error('Error saving vehicle:', err)
      const msg = 'Erro de conexão ao salvar veículo'
      setErrorMsg(msg)
      showToast(msg, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-zinc-900">
            {editingVehicle ? 'Editar Veículo' : 'Novo Veículo'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {errorMsg && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {errorMsg}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Placa *</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="ABC1D23"
                  value={plate}
                  onChange={(e) => {
                    setPlate(e.target.value.toUpperCase())
                    setLookupSuccess(false)
                  }}
                  onBlur={() => {
                    const cleanPlate = plate.toUpperCase().replace(/[^A-Z0-9]/g, '')
                    if ((cleanPlate.length === 7 || cleanPlate.length === 8) && !brand.trim()) handleLookupPlaca()
                  }}
                  maxLength={8}
                  className="flex-1"
                />
                {plate.replace(/[^A-Z0-9]/g, '').length >= 7 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleLookupPlaca}
                    disabled={lookingUpPlaca}
                    className="border-blue-200 text-blue-700 hover:bg-blue-50 gap-1 shrink-0"
                    title="Buscar dados pela placa"
                  >
                    {lookingUpPlaca ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  </Button>
                )}
              </div>
              {lookupSuccess && (
                <p className="text-xs text-emerald-600 flex items-center gap-1">
                  <Search className="w-3 h-3" /> Dados do veículo preenchidos automaticamente
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Chassi</Label>
              <Input
                placeholder="Número do chassi"
                value={chassi}
                onChange={(e) => setChassi(e.target.value.toUpperCase())}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Marca</Label>
              <Input
                placeholder="Toyota"
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Modelo</Label>
              <Input
                placeholder="Corolla"
                value={model}
                onChange={(e) => setModel(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Ano</Label>
              <Input
                placeholder="2024"
                type="number"
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Cor</Label>
              <Input
                placeholder="Prata"
                value={color}
                onChange={(e) => setColor(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">KM</Label>
              <Input
                placeholder="0"
                type="number"
                value={km}
                onChange={(e) => setKm(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={loading || !plate.trim()}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {editingVehicle ? 'Salvar Alterações' : 'Adicionar Veículo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================
// CLIENT DETAIL VIEW
// =============================================
function ClientDetail({
  client,
  onBack,
  onRefresh,
}: {
  client: ClientData
  onBack: () => void
  onRefresh: () => Promise<void>
}) {
  const [formOpen, setFormOpen] = useState(false)
  const [vehicleFormOpen, setVehicleFormOpen] = useState(false)
  const [editingVehicle, setEditingVehicle] = useState<VehicleData | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const handleDeleteVehicle = async (vehicleId: string) => {
    if (!confirm('Deseja realmente remover este veículo?')) return
    setDeleting(vehicleId)
    try {
      await apiFetch(`/api/vehicles/${vehicleId}`, { method: 'DELETE' })
      await onRefresh()
    } catch (err) {
      console.error('Error deleting vehicle:', err)
    } finally {
      setDeleting(null)
    }
  }

  const handleSave = async () => {
    await onRefresh()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </Button>
          <div>
            <h2 className="text-xl font-bold text-zinc-900">{client.name}</h2>
            <p className="text-sm text-zinc-500">
              Cliente desde {formatDate(client.createdAt)}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setFormOpen(true)}
          className="gap-1"
        >
          <Pencil className="w-3.5 h-3.5" /> Editar
        </Button>
      </div>

      {/* Client Info Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
            Informações do Cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {client.cpfCnpj && (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center">
                  <Users className="w-4 h-4 text-zinc-500" />
                </div>
                <div>
                  <p className="text-xs text-zinc-500">CPF/CNPJ</p>
                  <p className="text-sm font-medium text-zinc-900">
                    {formatCPFCNPJ(client.cpfCnpj)}
                  </p>
                </div>
              </div>
            )}
            {client.phone && (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center">
                  <Phone className="w-4 h-4 text-zinc-500" />
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Telefone</p>
                  <p className="text-sm font-medium text-zinc-900">{formatPhone(client.phone)}</p>
                </div>
              </div>
            )}
            {client.email && (
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center">
                  <Mail className="w-4 h-4 text-zinc-500" />
                </div>
                <div>
                  <p className="text-xs text-zinc-500">E-mail</p>
                  <p className="text-sm font-medium text-zinc-900">{client.email}</p>
                </div>
              </div>
            )}
            {(client.address || client.city) && (
              <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
                <div className="w-8 h-8 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0">
                  <MapPin className="w-4 h-4 text-zinc-500" />
                </div>
                <div>
                  <p className="text-xs text-zinc-500">Endereço</p>
                  <p className="text-sm font-medium text-zinc-900">
                    {[client.address, client.city, client.state, client.zipCode]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Tabs: Vehicles & Service Orders */}
      <Tabs defaultValue="vehicles" className="space-y-4">
        <TabsList className="bg-zinc-100">
          <TabsTrigger value="vehicles" className="gap-1.5">
            <Car className="w-3.5 h-3.5" /> Veículos ({client.vehicles.length})
          </TabsTrigger>
          <TabsTrigger value="orders" className="gap-1.5">
            <FileText className="w-3.5 h-3.5" /> Ordens ({client.serviceOrders?.length || 0})
          </TabsTrigger>
        </TabsList>

        {/* Vehicles Tab */}
        <TabsContent value="vehicles" className="space-y-4">
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() => { setEditingVehicle(null); setVehicleFormOpen(true) }}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
            >
              <Plus className="w-3.5 h-3.5" /> Adicionar Veículo
            </Button>
          </div>

          {client.vehicles.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
              <Car className="w-10 h-10 mb-2" />
              <p className="text-sm">Nenhum veículo cadastrado</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {client.vehicles.map((vehicle) => (
                <Card key={vehicle.id} className="relative group">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center">
                          <Car className="w-5 h-5 text-emerald-600" />
                        </div>
                        <div>
                          <p className="font-bold text-zinc-900 text-lg">{vehicle.plate}</p>
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-zinc-400 hover:text-zinc-700"
                          onClick={() => { setEditingVehicle(vehicle); setVehicleFormOpen(true) }}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                          onClick={() => handleDeleteVehicle(vehicle.id)}
                          disabled={deleting === vehicle.id}
                        >
                          {deleting === vehicle.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="w-3.5 h-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-0.5 text-sm text-zinc-600">
                      {vehicle.brand && vehicle.model && (
                        <p>{vehicle.brand} {vehicle.model}</p>
                      )}
                      {vehicle.year && <p>Ano: {vehicle.year}</p>}
                      {vehicle.color && <p>Cor: {vehicle.color}</p>}
                      {vehicle.km !== null && vehicle.km !== undefined && (
                        <p>KM: {vehicle.km.toLocaleString('pt-BR')}</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Service Orders Tab */}
        <TabsContent value="orders">
          {!client.serviceOrders || client.serviceOrders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-zinc-400">
              <FileText className="w-10 h-10 mb-2" />
              <p className="text-sm">Nenhuma ordem de serviço encontrada</p>
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nº OS</TableHead>
                      <TableHead>Veículo</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {client.serviceOrders.map((os) => {
                      const statusCfg = STATUS_CONFIG[os.status] || STATUS_CONFIG.ABERTA
                      return (
                        <TableRow key={os.id}>
                          <TableCell className="font-medium text-zinc-900">{os.number}</TableCell>
                          <TableCell>
                            {os.vehicle ? `${os.vehicle.plate} - ${os.vehicle.brand} ${os.vehicle.model}` : '—'}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`${statusCfg.color} font-medium`}>
                              {statusCfg.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium text-emerald-700">
                            {formatCurrency(os.totalAmount)}
                          </TableCell>
                          <TableCell className="text-zinc-500">{formatDate(os.createdAt)}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Dialogs */}
      <ClientFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSave={handleSave}
        editingClient={client}
      />
      <VehicleFormDialog
        open={vehicleFormOpen}
        onClose={() => { setVehicleFormOpen(false); setEditingVehicle(null) }}
        onSave={handleSave}
        clientId={client.id}
        editingVehicle={editingVehicle}
      />
    </div>
  )
}

// =============================================
// MAIN COMPONENT
// =============================================
export function ClientsModule() {
  const { user } = useAuthStore()
  const officeId = user?.officeId || ''

  const [clients, setClients] = useState<ClientData[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const limit = 12

  const [selectedClient, setSelectedClient] = useState<ClientData | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingClient, setEditingClient] = useState<ClientData | null>(null)

  const fetchClients = useCallback(async () => {
    if (!officeId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ officeId })
      if (search) params.set('search', search)
      params.set('page', String(page))
      params.set('limit', String(limit))

      const res = await apiFetch(`/api/clients?${params.toString()}`)
      if (res.success) {
        setClients(res.data)
        const total = res.pagination?.total || res.data.length
        setTotalPages(Math.max(1, Math.ceil(total / limit)))
      }
    } catch (err) {
      console.error('Error fetching clients:', err)
    } finally {
      setLoading(false)
    }
  }, [officeId, search, page])

  useEffect(() => {
    fetchClients()
  }, [fetchClients])

  const fetchClientDetail = async (id: string) => {
    try {
      const res = await apiFetch(`/api/clients/${id}`)
      if (res.success) setSelectedClient(res.data)
    } catch (err) {
      console.error('Error fetching client detail:', err)
    }
  }

  const handleSaveClient = async () => {
    await fetchClients()
    if (selectedClient) {
      await fetchClientDetail(selectedClient.id)
    }
  }

  const handleClientClick = (client: ClientData) => {
    fetchClientDetail(client.id)
  }

  // Detail view
  if (selectedClient) {
    return (
      <div className="p-4 md:p-6">
        <ClientDetail
          client={selectedClient}
          onBack={() => setSelectedClient(null)}
          onRefresh={async () => {
            await fetchClientDetail(selectedClient.id)
            await fetchClients()
          }}
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
          <h1 className="text-2xl font-bold text-zinc-900">Clientes</h1>
          <p className="text-sm text-zinc-500">Gerencie os clientes da oficina</p>
        </div>
        <Button
          onClick={() => { setEditingClient(null); setFormOpen(true) }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          <Plus className="w-4 h-4" /> Novo Cliente
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
        <Input
          placeholder="Buscar por nome, CPF, e-mail ou telefone..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          className="pl-9"
        />
      </div>

      {/* Client Cards */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-600" />
          <span className="ml-3 text-zinc-500">Carregando clientes...</span>
        </div>
      ) : clients.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-zinc-400">
          <Users className="w-12 h-12 mb-3" />
          <p className="text-lg font-medium">Nenhum cliente encontrado</p>
          <p className="text-sm">Cadastre um novo cliente para começar</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {clients.map((client) => (
            <Card
              key={client.id}
              className="cursor-pointer hover:shadow-md hover:border-emerald-200 transition-all"
              onClick={() => handleClientClick(client)}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center shrink-0">
                    <span className="text-emerald-700 font-bold text-sm">
                      {client.name
                        .split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')
                        .toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-zinc-900 truncate">{client.name}</p>
                    {client.cpfCnpj && (
                      <p className="text-xs text-zinc-500">
                        {formatCPFCNPJ(client.cpfCnpj)}
                      </p>
                    )}
                    <div className="flex items-center gap-3 mt-1.5 text-xs text-zinc-500">
                      {client.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {formatPhone(client.phone)}
                        </span>
                      )}
                    </div>
                    {client.email && (
                      <p className="text-xs text-zinc-500 truncate mt-0.5">{client.email}</p>
                    )}
                    <div className="flex items-center gap-1 mt-2">
                      <Badge variant="secondary" className="text-xs bg-zinc-100">
                        <Car className="w-3 h-3 mr-1" /> {client.vehicles?.length || 0} veículo(s)
                      </Badge>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

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

      {/* Client Form Dialog */}
      <ClientFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingClient(null) }}
        onSave={handleSaveClient}
        editingClient={editingClient}
      />
    </div>
  )
}
