'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { maskCNPJ, maskIE, validateCNPJ, validateIE, formatCNPJ } from '@/lib/validators'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
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
  Truck,
  Phone,
  Mail,
  MapPin,
  ArrowLeft,
  Pencil,
  Trash2,
  Package,
  Building2,
  FileText,
  Hash,
  ExternalLink,
  SearchCheck,
} from 'lucide-react'

// =============================================
// TYPES
// =============================================
interface PartSimple {
  id: string
  sku: string
  description: string
  quantity: number
  salePrice: number
}

interface InvoiceSimple {
  id: string
  numero: string
  dataEmissao: string
  totalNf: number
  status: string
}

interface SupplierData {
  id: string
  cnpj: string
  razaoSocial: string
  nomeFantasia?: string | null
  email?: string | null
  phone?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zipCode?: string | null
  ie?: string | null
  paymentTerms?: number
  deleted?: boolean
  officeId: string
  createdAt: string
  updatedAt: string
  _count?: { parts: number }
  parts?: PartSimple[]
  invoices?: InvoiceSimple[]
}

interface SupplierFormData {
  cnpj: string
  razaoSocial: string
  nomeFantasia: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  zipCode: string
  ie: string
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

const emptyForm: SupplierFormData = {
  cnpj: '',
  razaoSocial: '',
  nomeFantasia: '',
  email: '',
  phone: '',
  address: '',
  city: '',
  state: '',
  zipCode: '',
  ie: '',
}

// =============================================
// SUPPLIER FORM DIALOG
// =============================================
function SupplierFormDialog({
  open,
  onClose,
  onSave,
  initialData,
  loading,
}: {
  open: boolean
  onClose: () => void
  onSave: (data: SupplierFormData) => void
  initialData?: SupplierData | null
  loading: boolean
}) {
  const [form, setForm] = useState<SupplierFormData>(emptyForm)
  const [lookingUpCNPJ, setLookingUpCNPJ] = useState(false)
  const [lookingUpCEP, setLookingUpCEP] = useState(false)
  const [lookupSuccess, setLookupSuccess] = useState<string | null>(null)

  useEffect(() => {
    if (initialData) {
      setForm({
        cnpj: initialData.cnpj || '',
        razaoSocial: initialData.razaoSocial || '',
        nomeFantasia: initialData.nomeFantasia || '',
        email: initialData.email || '',
        phone: initialData.phone || '',
        address: initialData.address || '',
        city: initialData.city || '',
        state: initialData.state || '',
        zipCode: initialData.zipCode || '',
        ie: initialData.ie || '',
      })
    } else {
      setForm(emptyForm)
    }
    setLookupSuccess(null)
  }, [initialData, open])

  /** Busca automática por CNPJ na BrasilAPI */
  /** Busca automática por CNPJ via API com fallback multisserviço */
  const handleLookupCNPJ = async () => {
    const digits = form.cnpj.replace(/\D/g, '')
    if (digits.length !== 14) return

    setLookingUpCNPJ(true)
    setLookupSuccess(null)
    try {
      const res = await apiFetch(`/api/consulta/cnpj?cnpj=${digits}`)
      if (res.success && res.data) {
        const d = res.data
        setForm(prev => ({
          ...prev,
          razaoSocial: d.razaoSocial || prev.razaoSocial || '',
          nomeFantasia: d.nomeFantasia || prev.nomeFantasia || '',
          email: d.email || prev.email || '',
          phone: d.telefone ? (() => {
            const ph = d.telefone.replace(/\D/g, '')
            return ph.length >= 10 ? `(${ph.slice(0,2)}) ${ph.slice(2,7)}-${ph.slice(7,11)}` : d.telefone
          })() : prev.phone,
          address: d.address || prev.address || '',
          city: d.city || prev.city || '',
          state: d.state || prev.state || '',
          zipCode: d.zipCode || prev.zipCode || '',
          ie: d.ie || prev.ie || '',
        }))
        setLookupSuccess('CNPJ')
      } else if (!res.success) {
        alert(res.error || 'CNPJ não encontrado')
      }
    } catch {
      alert('Erro ao buscar CNPJ')
    } finally {
      setLookingUpCNPJ(false)
    }
  }

  /** Busca automática por CEP na BrasilAPI */
  const handleLookupCEP = async () => {
    const digits = form.zipCode.replace(/\D/g, '')
    if (digits.length !== 8) return

    setLookingUpCEP(true)
    setLookupSuccess(null)
    try {
      const res = await apiFetch(`/api/consulta/cep?cep=${digits}`)
      if (res.success && res.data) {
        const d = res.data
        setForm(prev => ({
          ...prev,
          address: prev.address || d.address || '',
          city: prev.city || d.city || '',
          state: prev.state || d.state || '',
        }))
        setLookupSuccess('CEP')
      } else if (!res.success) {
        alert(res.error || 'CEP não encontrado')
      }
    } catch {
      alert('Erro ao buscar CEP')
    } finally {
      setLookingUpCEP(false)
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // Validate CNPJ
    const cnpjError = validateCNPJ(form.cnpj)
    if (cnpjError) {
      alert(cnpjError)
      return
    }
    // Validate IE if provided
    const ieError = validateIE(form.ie)
    if (ieError) {
      alert(ieError)
      return
    }
    onSave(form)
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-zinc-900">
            {initialData ? 'Editar Fornecedor' : 'Novo Fornecedor'}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>CNPJ *</Label>
              <div className="flex gap-2">
                <Input
                  value={form.cnpj}
                  onChange={(e) => {
                    setForm({ ...form, cnpj: maskCNPJ(e.target.value) })
                    setLookupSuccess(null)
                  }}
                  onBlur={() => {
                    const digits = form.cnpj.replace(/\D/g, '')
                    if (digits.length === 14 && !form.razaoSocial) handleLookupCNPJ()
                  }}
                  placeholder="00.000.000/0000-00"
                  required
                  className="border-zinc-200 flex-1"
                  maxLength={18}
                />
                {form.cnpj.replace(/\D/g, '').length === 14 && (
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
              <Label>Inscrição Estadual</Label>
              <Input
                value={form.ie}
                onChange={(e) => setForm({ ...form, ie: maskIE(e.target.value) })}
                placeholder="000000000"
                className="border-zinc-200"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Razão Social *</Label>
            <Input
              value={form.razaoSocial}
              onChange={(e) => setForm({ ...form, razaoSocial: e.target.value })}
              placeholder="Nome empresarial completo"
              required
              className="border-zinc-200"
            />
          </div>

          <div className="space-y-2">
            <Label>Nome Fantasia</Label>
            <Input
              value={form.nomeFantasia}
              onChange={(e) => setForm({ ...form, nomeFantasia: e.target.value })}
              placeholder="Como o fornecedor é conhecido"
              className="border-zinc-200"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="contato@fornecedor.com"
                className="border-zinc-200"
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
          </div>

          <div className="space-y-2">
            <Label>Endereço</Label>
            <Input
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="Rua, número, complemento"
              className="border-zinc-200"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Cidade</Label>
              <Input
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                placeholder="Itapetinga"
                className="border-zinc-200"
              />
            </div>
            <div className="space-y-2">
              <Label>Estado</Label>
              <Input
                value={form.state}
                onChange={(e) => setForm({ ...form, state: e.target.value })}
                placeholder="BA"
                maxLength={2}
                className="border-zinc-200"
              />
            </div>
            <div className="space-y-2">
              <Label>CEP</Label>
              <div className="flex gap-2">
                <Input
                  value={form.zipCode}
                  onChange={(e) => {
                    setForm({ ...form, zipCode: e.target.value })
                    if (lookupSuccess === 'CEP') setLookupSuccess(null)
                  }}
                  onBlur={() => {
                    const digits = form.zipCode.replace(/\D/g, '')
                    if (digits.length === 8 && !form.address) handleLookupCEP()
                  }}
                  placeholder="00000-000"
                  className="border-zinc-200 flex-1"
                />
                {form.zipCode.replace(/\D/g, '').length === 8 && (
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

          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Salvando...
                </>
              ) : initialData ? (
                'Salvar Alterações'
              ) : (
                'Cadastrar Fornecedor'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// =============================================
// DELETE CONFIRM DIALOG
// =============================================
function DeleteDialog({
  open,
  onClose,
  onConfirm,
  supplier,
  loading,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  supplier: SupplierData | null
  loading: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold text-zinc-900">
            Confirmar Exclusão
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          <p className="text-zinc-600">
            Tem certeza que deseja excluir o fornecedor{' '}
            <strong className="text-zinc-900">{supplier?.razaoSocial}</strong>?
          </p>
          {supplier && supplier._count && supplier._count.parts > 0 && (
            <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-sm text-amber-700">
                Este fornecedor possui <strong>{supplier._count.parts} peça(s)</strong> vinculada(s).
                As peças não serão excluídas, mas ficarão sem fornecedor associado.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Excluindo...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                Excluir
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// =============================================
// SUPPLIER DETAIL VIEW
// =============================================
function SupplierDetail({
  supplier,
  onBack,
  onEdit,
  onDelete,
}: {
  supplier: SupplierData
  onBack: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const displayName = supplier.nomeFantasia || supplier.razaoSocial

  return (
    <div className="space-y-6 p-4 md:p-0">
      {/* Back & Actions Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 text-zinc-600">
            <ArrowLeft className="w-4 h-4" />
            Voltar
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5 border-zinc-200">
            <Pencil className="w-3.5 h-3.5" />
            Editar
          </Button>
          <Button variant="outline" size="sm" onClick={onDelete} className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50">
            <Trash2 className="w-3.5 h-3.5" />
            Excluir
          </Button>
        </div>
      </div>

      <Tabs defaultValue="info">
        <TabsList className="bg-zinc-100">
          <TabsTrigger value="info">Informações</TabsTrigger>
          <TabsTrigger value="parts">
            Peças ({supplier.parts?.length || supplier._count?.parts || 0})
          </TabsTrigger>
          {supplier.invoices && supplier.invoices.length > 0 && (
            <TabsTrigger value="invoices">
              NF-e ({supplier.invoices.length})
            </TabsTrigger>
          )}
        </TabsList>

        {/* Info Tab */}
        <TabsContent value="info" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Main Info Card */}
            <Card className="border-zinc-200/60">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                    <Building2 className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <CardTitle className="text-lg">{displayName}</CardTitle>
                    <CardDescription>CNPJ: {formatCNPJ(supplier.cnpj)}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {supplier.razaoSocial !== displayName && (
                  <div className="flex items-start gap-2 text-sm">
                    <Hash className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
                    <div>
                      <span className="text-zinc-500">Razão Social:</span>
                      <p className="text-zinc-800 font-medium">{supplier.razaoSocial}</p>
                    </div>
                  </div>
                )}
                {supplier.ie && (
                  <div className="flex items-center gap-2 text-sm">
                    <Hash className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span className="text-zinc-500">IE:</span>
                    <span className="text-zinc-800">{supplier.ie}</span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Contact Card */}
            <Card className="border-zinc-200/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
                  Contato
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {supplier.email && (
                  <div className="flex items-center gap-2 text-sm">
                    <Mail className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span className="text-zinc-700">{supplier.email}</span>
                  </div>
                )}
                {supplier.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-zinc-400 shrink-0" />
                    <span className="text-zinc-700">{formatPhone(supplier.phone)}</span>
                  </div>
                )}
                {!supplier.email && !supplier.phone && (
                  <p className="text-sm text-zinc-400 italic">Nenhum contato informado</p>
                )}
              </CardContent>
            </Card>

            {/* Address Card */}
            <Card className="border-zinc-200/60 md:col-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">
                  Endereço
                </CardTitle>
              </CardHeader>
              <CardContent>
                {supplier.address || supplier.city || supplier.state ? (
                  <div className="flex items-start gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
                    <div>
                      {supplier.address && <p className="text-zinc-700">{supplier.address}</p>}
                      <p className="text-zinc-700">
                        {[supplier.city, supplier.state].filter(Boolean).join(' - ')}
                        {supplier.zipCode ? ` · CEP: ${supplier.zipCode}` : ''}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-400 italic">Nenhum endereço informado</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Stats Row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
            <Card className="border-zinc-200/60">
              <CardContent className="pt-4 pb-4 text-center">
                <div className="text-2xl font-bold text-blue-600">{supplier._count?.parts || 0}</div>
                <p className="text-xs text-zinc-500 mt-1">Peças Fornecidas</p>
              </CardContent>
            </Card>
            <Card className="border-zinc-200/60">
              <CardContent className="pt-4 pb-4 text-center">
                <div className="text-2xl font-bold text-emerald-600">{supplier.invoices?.length || 0}</div>
                <p className="text-xs text-zinc-500 mt-1">Notas Fiscais</p>
              </CardContent>
            </Card>
            <Card className="border-zinc-200/60">
              <CardContent className="pt-4 pb-4 text-center">
                <div className="text-2xl font-bold text-zinc-800">{supplier.paymentTerms || 30}</div>
                <p className="text-xs text-zinc-500 mt-1">Dias Pagamento</p>
              </CardContent>
            </Card>
            <Card className="border-zinc-200/60">
              <CardContent className="pt-4 pb-4 text-center">
                <div className="text-sm font-bold text-zinc-800">{formatDate(supplier.createdAt)}</div>
                <p className="text-xs text-zinc-500 mt-1">Cadastrado em</p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Parts Tab */}
        <TabsContent value="parts" className="mt-4">
          {supplier.parts && supplier.parts.length > 0 ? (
            <Card className="border-zinc-200/60">
              <CardHeader>
                <CardTitle className="text-base">Peças Fornecidas</CardTitle>
                <CardDescription>Produtos cadastrados deste fornecedor</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>SKU</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="text-center">Estoque</TableHead>
                        <TableHead className="text-right">Preço Venda</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {supplier.parts.map((part) => (
                        <TableRow key={part.id}>
                          <TableCell className="font-mono text-xs text-zinc-600">{part.sku}</TableCell>
                          <TableCell className="font-medium text-zinc-900">{part.description}</TableCell>
                          <TableCell className="text-center">
                            <Badge
                              variant="outline"
                              className={
                                part.quantity <= 5
                                  ? 'bg-red-50 text-red-700 border-red-200'
                                  : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              }
                            >
                              {part.quantity} un
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium text-emerald-700">
                            {formatCurrency(part.salePrice)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-zinc-200/60">
              <CardContent className="py-12 text-center">
                <Package className="w-12 h-12 text-zinc-300 mx-auto mb-3" />
                <p className="text-zinc-500">Nenhuma peça vinculada a este fornecedor</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Invoices Tab */}
        <TabsContent value="invoices" className="mt-4">
          {supplier.invoices && supplier.invoices.length > 0 ? (
            <Card className="border-zinc-200/60">
              <CardHeader>
                <CardTitle className="text-base">Notas Fiscais</CardTitle>
                <CardDescription>Notas fiscais de compra deste fornecedor</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Número</TableHead>
                        <TableHead>Data Emissão</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {supplier.invoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="font-medium text-zinc-900">{inv.numero}</TableCell>
                          <TableCell className="text-zinc-600">{formatDate(inv.dataEmissao)}</TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={
                                inv.status === 'CONFIRMADA'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : inv.status === 'CANCELADA'
                                  ? 'bg-red-50 text-red-700 border-red-200'
                                  : 'bg-yellow-50 text-yellow-700 border-yellow-200'
                              }
                            >
                              {inv.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-medium text-emerald-700">
                            {formatCurrency(inv.totalNf)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-zinc-200/60">
              <CardContent className="py-12 text-center">
                <FileText className="w-12 h-12 text-zinc-300 mx-auto mb-3" />
                <p className="text-zinc-500">Nenhuma nota fiscal vinculada a este fornecedor</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// =============================================
// MAIN COMPONENT
// =============================================
export function SuppliersModule() {
  const { user } = useAuthStore()
  const officeId = user?.officeId || ''

  const [suppliers, setSuppliers] = useState<SupplierData[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const limit = 12

  const [selectedSupplier, setSelectedSupplier] = useState<SupplierData | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editingSupplier, setEditingSupplier] = useState<SupplierData | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deletingSupplier, setDeletingSupplier] = useState<SupplierData | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchSuppliers = useCallback(async () => {
    if (!officeId) return
    setLoading(true)
    try {
      const data = await apiFetch(
        `/api/suppliers?officeId=${officeId}&search=${encodeURIComponent(search)}&page=${page}&limit=${limit}`
      )
      if (data.success) {
        setSuppliers(data.data)
        setTotalPages(data.pagination?.totalPages || 1)
      }
    } catch {
      // silently handle
    } finally {
      setLoading(false)
    }
  }, [officeId, search, page])

  useEffect(() => {
    fetchSuppliers()
  }, [fetchSuppliers])

  const fetchSupplierDetail = async (id: string) => {
    try {
      const data = await apiFetch(`/api/suppliers/${id}`)
      if (data.success) {
        setSelectedSupplier(data.data)
      }
    } catch {
      // silently handle
    }
  }

  const handleSave = async (formData: SupplierFormData) => {
    setSaving(true)
    setError('')
    try {
      if (editingSupplier) {
        const data = await apiFetch(`/api/suppliers/${editingSupplier.id}`, {
          method: 'PUT',
          body: JSON.stringify(formData),
        })
        if (data.success) {
          setFormOpen(false)
          setEditingSupplier(null)
          fetchSuppliers()
          if (selectedSupplier?.id === editingSupplier.id) {
            fetchSupplierDetail(editingSupplier.id)
          }
        } else {
          setError(data.error || 'Erro ao atualizar fornecedor')
        }
      } else {
        const data = await apiFetch('/api/suppliers', {
          method: 'POST',
          body: JSON.stringify({ ...formData, officeId }),
        })
        if (data.success) {
          setFormOpen(false)
          fetchSuppliers()
        } else {
          setError(data.error || 'Erro ao cadastrar fornecedor')
        }
      }
    } catch {
      setError('Erro de conexão com o servidor')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingSupplier) return
    setSaving(true)
    try {
      const data = await apiFetch(`/api/suppliers/${deletingSupplier.id}`, {
        method: 'DELETE',
      })
      if (data.success) {
        setDeleteOpen(false)
        setDeletingSupplier(null)
        if (selectedSupplier?.id === deletingSupplier.id) {
          setSelectedSupplier(null)
        }
        fetchSuppliers()
      }
    } catch {
      // silently handle
    } finally {
      setSaving(false)
    }
  }

  // Detail view
  if (selectedSupplier) {
    return (
      <div className="max-w-5xl mx-auto">
        <SupplierDetail
          supplier={selectedSupplier}
          onBack={() => setSelectedSupplier(null)}
          onEdit={() => {
            setEditingSupplier(selectedSupplier)
            setFormOpen(true)
          }}
          onDelete={() => {
            setDeletingSupplier(selectedSupplier)
            setDeleteOpen(true)
          }}
        />

        {/* Form Dialog */}
        <SupplierFormDialog
          open={formOpen}
          onClose={() => {
            setFormOpen(false)
            setEditingSupplier(null)
          }}
          onSave={handleSave}
          initialData={editingSupplier}
          loading={saving}
        />

        {/* Delete Dialog */}
        <DeleteDialog
          open={deleteOpen}
          onClose={() => {
            setDeleteOpen(false)
            setDeletingSupplier(null)
          }}
          onConfirm={handleDelete}
          supplier={deletingSupplier}
          loading={saving}
        />
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 p-4 md:p-0">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">Fornecedores</h1>
          <p className="text-zinc-500 text-sm mt-1">
            Gerencie os fornecedores de peças e insumos da oficina
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingSupplier(null)
            setFormOpen(true)
          }}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          <Plus className="w-4 h-4" />
          Novo Fornecedor
        </Button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <Input
            placeholder="Buscar por razão social, fantasia, CNPJ..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            className="pl-9 border-zinc-200"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
      )}

      {/* Suppliers Table - Desktop */}
      <Card className="border-zinc-200/60 hidden md:block">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
              <span className="ml-2 text-zinc-500">Carregando fornecedores...</span>
            </div>
          ) : suppliers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Truck className="w-12 h-12 text-zinc-300 mb-3" />
              <p className="text-zinc-500">
                {search ? 'Nenhum fornecedor encontrado' : 'Nenhum fornecedor cadastrado'}
              </p>
              {!search && (
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-1.5 border-emerald-200 text-emerald-700"
                  onClick={() => {
                    setEditingSupplier(null)
                    setFormOpen(true)
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  Cadastrar Fornecedor
                </Button>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>CNPJ</TableHead>
                  <TableHead>Contato</TableHead>
                  <TableHead>Localização</TableHead>
                  <TableHead className="text-center">Peças</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((supplier) => {
                  const displayName = supplier.nomeFantasia || supplier.razaoSocial
                  return (
                    <TableRow
                      key={supplier.id}
                      className="cursor-pointer hover:bg-emerald-50/50"
                      onClick={() => fetchSupplierDetail(supplier.id)}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                            <Building2 className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-medium text-zinc-900">{displayName}</p>
                            {supplier.nomeFantasia && (
                              <p className="text-xs text-zinc-500">{supplier.razaoSocial}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-mono text-sm text-zinc-600">
                        {formatCNPJ(supplier.cnpj)}
                      </TableCell>
                      <TableCell>
                        <div className="space-y-0.5">
                          {supplier.phone && (
                            <div className="flex items-center gap-1.5 text-sm text-zinc-600">
                              <Phone className="w-3 h-3" />
                              {formatPhone(supplier.phone)}
                            </div>
                          )}
                          {supplier.email && (
                            <div className="flex items-center gap-1.5 text-sm text-zinc-600">
                              <Mail className="w-3 h-3" />
                              <span className="truncate max-w-[160px]">{supplier.email}</span>
                            </div>
                          )}
                          {!supplier.phone && !supplier.email && (
                            <span className="text-xs text-zinc-400">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-zinc-600">
                        {supplier.city || supplier.state ? (
                          <div className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" />
                            {[supplier.city, supplier.state].filter(Boolean).join(' - ')}
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="secondary" className="bg-blue-50 text-blue-700 text-xs">
                          {supplier._count?.parts || 0}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-zinc-400 hover:text-blue-600"
                            onClick={() => fetchSupplierDetail(supplier.id)}
                          >
                            <ExternalLink className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-zinc-400 hover:text-emerald-600"
                            onClick={() => {
                              setEditingSupplier(supplier)
                              setFormOpen(true)
                            }}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-zinc-400 hover:text-red-600"
                            onClick={() => {
                              setDeletingSupplier(supplier)
                              setDeleteOpen(true)
                            }}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Suppliers Cards - Mobile */}
      <div className="md:hidden space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
            <span className="ml-2 text-zinc-500">Carregando...</span>
          </div>
        ) : suppliers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Truck className="w-12 h-12 text-zinc-300 mb-3" />
            <p className="text-zinc-500">
              {search ? 'Nenhum fornecedor encontrado' : 'Nenhum fornecedor cadastrado'}
            </p>
          </div>
        ) : (
          suppliers.map((supplier) => {
            const displayName = supplier.nomeFantasia || supplier.razaoSocial
            return (
              <Card
                key={supplier.id}
                className="border-zinc-200/60 cursor-pointer hover:shadow-md transition-shadow"
                onClick={() => fetchSupplierDetail(supplier.id)}
              >
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5 text-blue-600" />
                      </div>
                      <div>
                        <p className="font-semibold text-zinc-900">{displayName}</p>
                        <p className="text-xs text-zinc-500 font-mono">{formatCNPJ(supplier.cnpj)}</p>
                      </div>
                    </div>
                    <Badge variant="secondary" className="bg-blue-50 text-blue-700 text-xs">
                      {supplier._count?.parts || 0} peças
                    </Badge>
                  </div>
                  <div className="space-y-1 ml-13">
                    {supplier.phone && (
                      <p className="text-xs text-zinc-500 flex items-center gap-1">
                        <Phone className="w-3 h-3" /> {formatPhone(supplier.phone)}
                      </p>
                    )}
                    {supplier.city && (
                      <p className="text-xs text-zinc-500 flex items-center gap-1">
                        <MapPin className="w-3 h-3" /> {[supplier.city, supplier.state].filter(Boolean).join(' - ')}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-500">
            Página {page} de {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="gap-1 border-zinc-200"
            >
              <ChevronLeft className="w-4 h-4" />
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="gap-1 border-zinc-200"
            >
              Próxima
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Form Dialog */}
      <SupplierFormDialog
        open={formOpen}
        onClose={() => {
          setFormOpen(false)
          setEditingSupplier(null)
          setError('')
        }}
        onSave={handleSave}
        initialData={editingSupplier}
        loading={saving}
      />

      {/* Delete Dialog */}
      <DeleteDialog
        open={deleteOpen}
        onClose={() => {
          setDeleteOpen(false)
          setDeletingSupplier(null)
        }}
        onConfirm={handleDelete}
        supplier={deletingSupplier}
        loading={saving}
      />
    </div>
  )
}
