'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { maskNCM, maskCFOP, validateNCM, validateCFOP } from '@/lib/validators'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Package,
  Plus,
  Search,
  AlertTriangle,
  Edit,
  ArrowUpDown,
  Eye,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  Loader2,
  TrendingUp,
  TrendingDown,
  Warehouse,
  Printer,
} from 'lucide-react'
import { printReport, buildReportHeader, fmtCurrency, fmtDate } from '@/lib/print-utils'

// =============================================
// TYPES
// =============================================
interface Supplier {
  id: string
  razaoSocial: string
  nomeFantasia?: string | null
  cnpj: string
}

interface Part {
  id: string
  sku: string
  description: string
  ncm?: string | null
  cfop?: string | null
  unit: string
  quantity: number
  minQuantity: number
  costPrice: number
  salePrice: number
  location?: string | null
  batch?: string | null
  validity?: string | null
  cst?: string | null
  csosn?: string | null
  supplierId?: string | null
  supplier?: Supplier | null
  createdAt: string
  updatedAt: string
}

interface StockMovement {
  id: string
  type: string
  quantity: number
  unitCost: number
  reason?: string | null
  reference?: string | null
  partId: string
  part?: {
    id: string
    sku: string
    description: string
    unit: string
    quantity: number
  }
  createdAt: string
}

interface StockAlert {
  id: string
  sku: string
  description: string
  currentQuantity: number
  minQuantity: number
  deficit: number
  unit: string
  costPrice: number
  salePrice: number
  location?: string | null
  supplier?: {
    id: string
    name: string
    phone?: string | null
    email?: string | null
  } | null
  severity: 'CRITICAL' | 'WARNING'
}

type ViewMode = 'list' | 'detail' | 'alerts'

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

function getRowColor(part: Part): string {
  if (part.quantity === 0) return 'bg-red-50 dark:bg-red-950/30'
  if (part.quantity <= part.minQuantity) return 'bg-orange-50 dark:bg-orange-950/30'
  return ''
}

function getStockBadge(part: Part) {
  if (part.quantity === 0) {
    return <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">Sem estoque</Badge>
  }
  if (part.quantity <= part.minQuantity) {
    return <Badge className="bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100">Estoque baixo</Badge>
  }
  return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100">Normal</Badge>
}

// =============================================
// EMPTY PART FORM
// =============================================
function emptyPartForm(): PartForm {
  return {
    sku: '',
    description: '',
    ncm: '',
    cfop: '',
    unit: 'UN',
    quantity: 0,
    minQuantity: 0,
    costPrice: 0,
    salePrice: 0,
    location: '',
    batch: '',
    validity: '',
    cst: '',
    csosn: '',
    supplierId: '',
  }
}

interface PartForm {
  sku: string
  description: string
  ncm: string
  cfop: string
  unit: string
  quantity: number
  minQuantity: number
  costPrice: number
  salePrice: number
  location: string
  batch: string
  validity: string
  cst: string
  csosn: string
  supplierId: string
}

// =============================================
// MAIN COMPONENT
// =============================================
export default function InventoryModule() {
  const { office } = useAuthStore()
  const officeId = office?.id || ''

  // --- State ---
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [parts, setParts] = useState<Part[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [alerts, setAlerts] = useState<StockAlert[]>([])
  const [alertsSummary, setAlertsSummary] = useState({ total: 0, critical: 0, warning: 0 })
  const [selectedPart, setSelectedPart] = useState<Part | null>(null)
  const [partMovements, setPartMovements] = useState<StockMovement[]>([])
  const [search, setSearch] = useState('')
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const pageSize = 10

  // Dialog states
  const [showPartDialog, setShowPartDialog] = useState(false)
  const [showMovementDialog, setShowMovementDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [partToDelete, setPartToDelete] = useState<Part | null>(null)
  const [editingPart, setEditingPart] = useState<Part | null>(null)
  const [partForm, setPartForm] = useState<PartForm>(emptyPartForm())
  const [saving, setSaving] = useState(false)

  // Movement form
  const [movementForm, setMovementForm] = useState({
    partId: '',
    type: 'ENTRADA',
    quantity: 1,
    unitCost: 0,
    reason: '',
    reference: '',
  })
  const [savingMovement, setSavingMovement] = useState(false)

  // --- Fetch parts ---
  const fetchParts = useCallback(async () => {
    if (!officeId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ officeId })
      if (search) params.set('search', search)
      if (lowStockOnly) params.set('lowStock', 'true')
      const res = await apiFetch(`/api/parts?${params.toString()}`)
      if (res.success) {
        setParts(res.data)
        setPage(1)
      }
    } catch (err) {
      console.error('Erro ao buscar peças:', err)
    } finally {
      setLoading(false)
    }
  }, [officeId, search, lowStockOnly])

  // --- Fetch suppliers ---
  const fetchSuppliers = useCallback(async () => {
    if (!officeId) return
    try {
      const res = await apiFetch(`/api/suppliers?officeId=${officeId}&limit=100`)
      if (res.success) {
        setSuppliers(res.data)
      }
    } catch (err) {
      console.error('Erro ao buscar fornecedores:', err)
    }
  }, [officeId])

  // --- Fetch alerts ---
  const fetchAlerts = useCallback(async () => {
    if (!officeId) return
    try {
      const res = await apiFetch(`/api/stock-alerts?officeId=${officeId}`)
      if (res.success) {
        setAlerts(res.data.alerts)
        setAlertsSummary({
          total: res.data.total,
          critical: res.data.critical,
          warning: res.data.warning,
        })
      }
    } catch (err) {
      console.error('Erro ao buscar alertas:', err)
    }
  }, [officeId])

  // --- Fetch part movements ---
  const fetchPartMovements = useCallback(async (partId: string) => {
    if (!officeId) return
    try {
      const res = await apiFetch(`/api/stock-movements?officeId=${officeId}&partId=${partId}`)
      if (res.success) {
        setPartMovements(res.data)
      }
    } catch (err) {
      console.error('Erro ao buscar movimentações:', err)
    }
  }, [officeId])

  // --- Effects ---
  useEffect(() => {
    fetchParts()
  }, [fetchParts])

  useEffect(() => {
    fetchSuppliers()
  }, [fetchSuppliers])

  useEffect(() => {
    if (viewMode === 'alerts') fetchAlerts()
  }, [viewMode, fetchAlerts])

  // --- Handlers ---
  const handleOpenNewPart = () => {
    setEditingPart(null)
    setPartForm(emptyPartForm())
    setShowPartDialog(true)
  }

  const handleOpenEditPart = (part: Part) => {
    setEditingPart(part)
    setPartForm({
      sku: part.sku,
      description: part.description,
      ncm: part.ncm || '',
      cfop: part.cfop || '',
      unit: part.unit || 'UN',
      quantity: part.quantity,
      minQuantity: part.minQuantity,
      costPrice: part.costPrice,
      salePrice: part.salePrice,
      location: part.location || '',
      batch: part.batch || '',
      validity: part.validity ? new Date(part.validity).toISOString().split('T')[0] : '',
      cst: part.cst || '',
      csosn: part.csosn || '',
      supplierId: part.supplierId || '',
    })
    setShowPartDialog(true)
  }

  const handleSavePart = async () => {
    if (!partForm.sku.trim() || !partForm.description.trim()) return
    // Validate NCM if provided
    const ncmError = validateNCM(partForm.ncm)
    if (ncmError) {
      alert(ncmError)
      return
    }
    // Validate CFOP if provided
    const cfopError = validateCFOP(partForm.cfop)
    if (cfopError) {
      alert(cfopError)
      return
    }
    setSaving(true)
    try {
      if (editingPart) {
        const res = await apiFetch(`/api/parts/${editingPart.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            sku: partForm.sku,
            description: partForm.description,
            ncm: partForm.ncm || null,
            cfop: partForm.cfop || null,
            unit: partForm.unit,
            minQuantity: partForm.minQuantity,
            costPrice: partForm.costPrice,
            salePrice: partForm.salePrice,
            location: partForm.location || null,
            batch: partForm.batch || null,
            validity: partForm.validity || null,
            cst: partForm.cst || null,
            csosn: partForm.csosn || null,
            supplierId: partForm.supplierId || null,
          }),
        })
        if (res.success) {
          setShowPartDialog(false)
          fetchParts()
          if (selectedPart?.id === editingPart.id) {
            const detail = await apiFetch(`/api/parts/${editingPart.id}`)
            if (detail.success) setSelectedPart(detail.data)
          }
        }
      } else {
        const res = await apiFetch('/api/parts', {
          method: 'POST',
          body: JSON.stringify({
            officeId,
            sku: partForm.sku,
            description: partForm.description,
            ncm: partForm.ncm || null,
            cfop: partForm.cfop || null,
            unit: partForm.unit,
            quantity: partForm.quantity,
            minQuantity: partForm.minQuantity,
            costPrice: partForm.costPrice,
            salePrice: partForm.salePrice,
            location: partForm.location || null,
            batch: partForm.batch || null,
            validity: partForm.validity || null,
            cst: partForm.cst || null,
            csosn: partForm.csosn || null,
            supplierId: partForm.supplierId || null,
          }),
        })
        if (res.success) {
          setShowPartDialog(false)
          fetchParts()
        }
      }
    } catch (err) {
      console.error('Erro ao salvar peça:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleDeletePart = async () => {
    if (!partToDelete) return
    setSaving(true)
    try {
      const res = await apiFetch(`/api/parts/${partToDelete.id}`, { method: 'DELETE' })
      if (res.success) {
        setShowDeleteDialog(false)
        setPartToDelete(null)
        fetchParts()
        if (selectedPart?.id === partToDelete.id) {
          setViewMode('list')
          setSelectedPart(null)
        }
      }
    } catch (err) {
      console.error('Erro ao excluir peça:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleViewPart = async (part: Part) => {
    setSelectedPart(part)
    setViewMode('detail')
    await fetchPartMovements(part.id)
  }

  const handleOpenMovement = (partId?: string) => {
    setMovementForm({
      partId: partId || '',
      type: 'ENTRADA',
      quantity: 1,
      unitCost: 0,
      reason: '',
      reference: '',
    })
    setShowMovementDialog(true)
  }

  const handleSaveMovement = async () => {
    if (!movementForm.partId || !movementForm.quantity || movementForm.quantity <= 0) return
    setSavingMovement(true)
    try {
      const res = await apiFetch('/api/stock-movements', {
        method: 'POST',
        body: JSON.stringify({
          officeId,
          partId: movementForm.partId,
          type: movementForm.type,
          quantity: movementForm.quantity,
          unitCost: movementForm.type === 'ENTRADA' ? movementForm.unitCost : 0,
          reason: movementForm.reason || null,
          reference: movementForm.reference || null,
        }),
      })
      if (res.success) {
        setShowMovementDialog(false)
        fetchParts()
        if (selectedPart?.id === movementForm.partId) {
          await fetchPartMovements(movementForm.partId)
          const detail = await apiFetch(`/api/parts/${movementForm.partId}`)
          if (detail.success) setSelectedPart(detail.data)
        }
      }
    } catch (err) {
      console.error('Erro ao registrar movimentação:', err)
    } finally {
      setSavingMovement(false)
    }
  }

  // --- Pagination ---
  const paginatedParts = parts.slice((page - 1) * pageSize, page * pageSize)
  const totalPages = Math.max(1, Math.ceil(parts.length / pageSize))

  // --- Get projected stock ---
  const getProjectedStock = () => {
    const part = parts.find(p => p.id === movementForm.partId)
    if (!part) return null
    const current = part.quantity
    if (movementForm.type === 'ENTRADA') return current + movementForm.quantity
    return current - movementForm.quantity
  }

  const getCurrentStock = () => {
    const part = parts.find(p => p.id === movementForm.partId)
    return part?.quantity ?? 0
  }

  // --- Print Handlers ---
  const handlePrintInventory = () => {
    const officeName = office?.name || 'KiteOS'
    const header = buildReportHeader('Relatório de Estoque', officeName)
    // Summary
    const totalParts = parts.length
    const lowStock = parts.filter(p => p.quantity <= p.minQuantity).length
    const noStock = parts.filter(p => p.quantity === 0).length
    const totalValue = parts.reduce((s, p) => s + (p.quantity * p.costPrice), 0)
    const summaryHtml = `
      <div class="summary-grid">
        <div class="summary-card green"><div class="label">Total de Peças</div><div class="value text-green">${totalParts}</div></div>
        <div class="summary-card red"><div class="label">Sem Estoque</div><div class="value text-red">${noStock}</div></div>
        <div class="summary-card amber"><div class="label">Estoque Baixo</div><div class="value text-amber">${lowStock}</div></div>
        <div class="summary-card blue"><div class="label">Valor em Estoque</div><div class="value text-blue">${fmtCurrency(totalValue)}</div></div>
      </div>
    `
    let rows = ''
    parts.forEach((p) => {
      const status = p.quantity === 0 ? 'Sem estoque' : p.quantity <= p.minQuantity ? 'Estoque baixo' : 'Normal'
      rows += `<tr>
        <td>${p.sku}</td>
        <td>${p.description}</td>
        <td class="text-center">${p.quantity}</td>
        <td class="text-center">${p.minQuantity}</td>
        <td class="text-right">${fmtCurrency(p.costPrice)}</td>
        <td class="text-right">${fmtCurrency(p.salePrice)}</td>
        <td>${p.supplier?.nomeFantasia || p.supplier?.razaoSocial || '—'}</td>
        <td>${status}</td>
      </tr>`
    })
    const table = `
      <table>
        <thead><tr>
          <th>SKU</th><th>Descrição</th><th class="text-center">Qtd</th><th class="text-center">Qtd Mín</th><th class="text-right">Preço Custo</th><th class="text-right">Preço Venda</th><th>Fornecedor</th><th>Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`
    printReport({ title: 'Relatório de Estoque', contentHtml: header + summaryHtml + table })
  }

  const handlePrintAlerts = () => {
    const officeName = office?.name || 'KiteOS'
    const header = buildReportHeader('Alertas de Estoque', officeName)
    // Summary
    const summaryHtml = `
      <div class="summary-grid">
        <div class="summary-card red"><div class="label">Críticos</div><div class="value text-red">${alertsSummary.critical}</div></div>
        <div class="summary-card amber"><div class="label">Atenção</div><div class="value text-amber">${alertsSummary.warning}</div></div>
        <div class="summary-card blue"><div class="label">Total Alertas</div><div class="value text-blue">${alertsSummary.total}</div></div>
      </div>
    `
    let rows = ''
    alerts.forEach((a) => {
      const sevLabel = a.severity === 'CRITICAL' ? 'CRÍTICO' : 'ATENÇÃO'
      const sevClass = a.severity === 'CRITICAL' ? 'text-red' : 'text-amber'
      rows += `<tr>
        <td>${a.sku}</td>
        <td>${a.description}</td>
        <td class="text-center ${sevClass}">${a.currentQuantity}</td>
        <td class="text-center">${a.minQuantity}</td>
        <td class="text-center ${sevClass}">${a.deficit}</td>
        <td class="text-right">${fmtCurrency(a.costPrice)}</td>
        <td>${a.supplier?.name || '—'}</td>
        <td class="${sevClass}">${sevLabel}</td>
      </tr>`
    })
    const table = `
      <table>
        <thead><tr>
          <th>SKU</th><th>Descrição</th><th class="text-center">Atual</th><th class="text-center">Mínimo</th><th class="text-center">Déficit</th><th class="text-right">Custo</th><th>Fornecedor</th><th>Severidade</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`
    printReport({ title: 'Alertas de Estoque', contentHtml: header + summaryHtml + table })
  }

  // =============================================
  // RENDER: LIST VIEW
  // =============================================
  if (viewMode === 'list') {
    return (
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Package className="h-6 w-6 text-emerald-600" />
            <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Estoque</h1>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant={alertsSummary.critical > 0 ? 'destructive' : 'outline'}
              size="sm"
              onClick={() => setViewMode('alerts')}
              className="gap-1.5"
            >
              <AlertTriangle className="h-4 w-4" />
              Alertas
              {alertsSummary.total > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {alertsSummary.total}
                </Badge>
              )}
            </Button>
            <Button size="sm" variant="outline" onClick={handlePrintInventory} disabled={parts.length === 0} className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
              <Printer className="h-4 w-4" />
              Imprimir
            </Button>
            <Button size="sm" onClick={handleOpenNewPart} className="bg-emerald-600 hover:bg-emerald-700 gap-1.5">
              <Plus className="h-4 w-4" />
              Nova Peça
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleOpenMovement()} className="gap-1.5">
              <ArrowUpDown className="h-4 w-4" />
              Movimentação
            </Button>
          </div>
        </div>

        {/* Search & Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
                <Input
                  placeholder="Buscar por SKU, descrição, NCM..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="lowStockFilter"
                  checked={lowStockOnly}
                  onCheckedChange={setLowStockOnly}
                />
                <Label htmlFor="lowStockFilter" className="text-sm whitespace-nowrap cursor-pointer">
                  Apenas estoque baixo
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Parts Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
              </div>
            ) : parts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
                <Warehouse className="h-12 w-12 mb-3 opacity-40" />
                <p className="text-lg font-medium">Nenhuma peça encontrada</p>
                <p className="text-sm">Adicione peças ao estoque clicando em &quot;Nova Peça&quot;</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">SKU</TableHead>
                        <TableHead>Descrição</TableHead>
                        <TableHead className="text-center">Qtd</TableHead>
                        <TableHead className="text-center">Qtd Mín</TableHead>
                        <TableHead className="text-right">Preço Custo</TableHead>
                        <TableHead className="text-right">Preço Venda</TableHead>
                        <TableHead>Fornecedor</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedParts.map((part) => (
                        <TableRow key={part.id} className={getRowColor(part)}>
                          <TableCell className="font-mono text-sm font-medium">{part.sku}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{part.description}</TableCell>
                          <TableCell className="text-center font-medium">{part.quantity}</TableCell>
                          <TableCell className="text-center text-zinc-500">{part.minQuantity}</TableCell>
                          <TableCell className="text-right">{formatCurrency(part.costPrice)}</TableCell>
                          <TableCell className="text-right">{formatCurrency(part.salePrice)}</TableCell>
                          <TableCell className="max-w-[120px] truncate">
                            {part.supplier?.nomeFantasia || part.supplier?.razaoSocial || '—'}
                          </TableCell>
                          <TableCell>{getStockBadge(part)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" onClick={() => handleViewPart(part)} title="Ver detalhes">
                                <Eye className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => handleOpenEditPart(part)} title="Editar">
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => { setPartToDelete(part); setShowDeleteDialog(true) }} title="Excluir">
                                <Trash2 className="h-4 w-4 text-red-500" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {/* Pagination */}
                <div className="flex items-center justify-between px-4 py-3 border-t">
                  <p className="text-sm text-zinc-500">
                    {parts.length} peça{parts.length !== 1 ? 's' : ''} encontrada{parts.length !== 1 ? 's' : ''}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="text-sm font-medium">{page} / {totalPages}</span>
                    <Button variant="outline" size="icon" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* New/Edit Part Dialog */}
        <Dialog open={showPartDialog} onOpenChange={setShowPartDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Package className="h-5 w-5 text-emerald-600" />
                {editingPart ? 'Editar Peça' : 'Nova Peça'}
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="sku">SKU *</Label>
                <Input
                  id="sku"
                  placeholder="Ex: PAD-001"
                  value={partForm.sku}
                  onChange={(e) => setPartForm({ ...partForm, sku: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">Descrição *</Label>
                <Input
                  id="description"
                  placeholder="Descrição da peça"
                  value={partForm.description}
                  onChange={(e) => setPartForm({ ...partForm, description: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ncm">NCM</Label>
                <Input
                  id="ncm"
                  placeholder="0000.00.00"
                  value={partForm.ncm}
                  onChange={(e) => setPartForm({ ...partForm, ncm: maskNCM(e.target.value) })}
                  maxLength={10}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cfop">CFOP</Label>
                <Input
                  id="cfop"
                  placeholder="Código Fiscal (4 dígitos)"
                  value={partForm.cfop}
                  onChange={(e) => setPartForm({ ...partForm, cfop: maskCFOP(e.target.value) })}
                  maxLength={4}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Unidade</Label>
                <Select value={partForm.unit} onValueChange={(v) => setPartForm({ ...partForm, unit: v })}>
                  <SelectTrigger id="unit">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UN">UN - Unidade</SelectItem>
                    <SelectItem value="PC">PC - Peça</SelectItem>
                    <SelectItem value="KG">KG - Quilograma</SelectItem>
                    <SelectItem value="LT">LT - Litro</SelectItem>
                    <SelectItem value="MT">MT - Metro</SelectItem>
                    <SelectItem value="CX">CX - Caixa</SelectItem>
                    <SelectItem value="RL">RL - Rolo</SelectItem>
                    <SelectItem value="PR">PR - Par</SelectItem>
                    <SelectItem value="JT">JT - Jogo</SelectItem>
                    <SelectItem value="SC">SC - Saco</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplierId">Fornecedor</Label>
                <Select value={partForm.supplierId} onValueChange={(v) => setPartForm({ ...partForm, supplierId: v })}>
                  <SelectTrigger id="supplierId">
                    <SelectValue placeholder="Selecione o fornecedor" />
                  </SelectTrigger>
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

              <Separator className="col-span-full" />

              <div className="space-y-2">
                <Label htmlFor="quantity">Quantidade</Label>
                <Input
                  id="quantity"
                  type="number"
                  min={0}
                  value={partForm.quantity}
                  onChange={(e) => setPartForm({ ...partForm, quantity: parseFloat(e.target.value) || 0 })}
                  disabled={!!editingPart}
                />
                {editingPart && (
                  <p className="text-xs text-zinc-500">Use &quot;Movimentação&quot; para alterar a quantidade</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="minQuantity">Quantidade Mínima</Label>
                <Input
                  id="minQuantity"
                  type="number"
                  min={0}
                  value={partForm.minQuantity}
                  onChange={(e) => setPartForm({ ...partForm, minQuantity: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="costPrice">Preço de Custo (R$)</Label>
                <Input
                  id="costPrice"
                  type="number"
                  min={0}
                  step={0.01}
                  value={partForm.costPrice}
                  onChange={(e) => setPartForm({ ...partForm, costPrice: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="salePrice">Preço de Venda (R$)</Label>
                <Input
                  id="salePrice"
                  type="number"
                  min={0}
                  step={0.01}
                  value={partForm.salePrice}
                  onChange={(e) => setPartForm({ ...partForm, salePrice: parseFloat(e.target.value) || 0 })}
                />
              </div>

              <Separator className="col-span-full" />

              <div className="space-y-2">
                <Label htmlFor="location">Localização</Label>
                <Input
                  id="location"
                  placeholder="Ex: Prateleira A3"
                  value={partForm.location}
                  onChange={(e) => setPartForm({ ...partForm, location: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="batch">Lote</Label>
                <Input
                  id="batch"
                  placeholder="Número do lote"
                  value={partForm.batch}
                  onChange={(e) => setPartForm({ ...partForm, batch: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="validity">Validade</Label>
                <Input
                  id="validity"
                  type="date"
                  value={partForm.validity}
                  onChange={(e) => setPartForm({ ...partForm, validity: e.target.value })}
                />
              </div>

              <Separator className="col-span-full" />

              <div className="space-y-2">
                <Label htmlFor="cst">CST</Label>
                <Input
                  id="cst"
                  placeholder="Código de Situação Tributária"
                  value={partForm.cst}
                  onChange={(e) => setPartForm({ ...partForm, cst: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="csosn">CSOSN</Label>
                <Input
                  id="csosn"
                  placeholder="Código Situação Operação SN"
                  value={partForm.csosn}
                  onChange={(e) => setPartForm({ ...partForm, csosn: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPartDialog(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSavePart}
                disabled={saving || !partForm.sku.trim() || !partForm.description.trim()}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {editingPart ? 'Salvar Alterações' : 'Criar Peça'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Stock Movement Dialog */}
        <Dialog open={showMovementDialog} onOpenChange={setShowMovementDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowUpDown className="h-5 w-5 text-emerald-600" />
                Movimentação de Estoque
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Peça *</Label>
                <Select value={movementForm.partId} onValueChange={(v) => setMovementForm({ ...movementForm, partId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a peça" />
                  </SelectTrigger>
                  <SelectContent>
                    {parts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.sku} — {p.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select value={movementForm.type} onValueChange={(v) => setMovementForm({ ...movementForm, type: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ENTRADA">
                      <span className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-emerald-600" /> ENTRADA
                      </span>
                    </SelectItem>
                    <SelectItem value="SAIDA">
                      <span className="flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-red-500" /> SAÍDA
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Quantidade *</Label>
                  <Input
                    type="number"
                    min={1}
                    value={movementForm.quantity}
                    onChange={(e) => setMovementForm({ ...movementForm, quantity: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                {movementForm.type === 'ENTRADA' && (
                  <div className="space-y-2">
                    <Label>Custo Unitário (R$)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={movementForm.unitCost}
                      onChange={(e) => setMovementForm({ ...movementForm, unitCost: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Motivo</Label>
                <Input
                  placeholder="Ex: Compra, Ajuste, etc."
                  value={movementForm.reason}
                  onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Referência</Label>
                <Input
                  placeholder="Ex: NF 12345, OS 0042"
                  value={movementForm.reference}
                  onChange={(e) => setMovementForm({ ...movementForm, reference: e.target.value })}
                />
              </div>

              {/* Stock projection */}
              {movementForm.partId && (
                <Card className="bg-zinc-50 dark:bg-zinc-900">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-zinc-500">Estoque atual</p>
                        <p className="font-bold text-lg">{getCurrentStock()}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Estoque projetado</p>
                        <p className={`font-bold text-lg ${
                          (getProjectedStock() ?? 0) < 0
                            ? 'text-red-600'
                            : (getProjectedStock() ?? 0) === 0
                              ? 'text-orange-500'
                              : 'text-emerald-600'
                        }`}>
                          {getProjectedStock() ?? '—'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowMovementDialog(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSaveMovement}
                disabled={savingMovement || !movementForm.partId || movementForm.quantity <= 0}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {savingMovement && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Registrar Movimentação
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-red-600">
                <Trash2 className="h-5 w-5" />
                Confirmar Exclusão
              </DialogTitle>
            </DialogHeader>
            <p className="py-4 text-zinc-600 dark:text-zinc-400">
              Tem certeza que deseja excluir a peça <strong>{partToDelete?.sku} — {partToDelete?.description}</strong>?
              Esta ação não pode ser desfeita.
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={handleDeletePart} disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Excluir
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // =============================================
  // RENDER: DETAIL VIEW
  // =============================================
  if (viewMode === 'detail' && selectedPart) {
    return (
      <div className="space-y-4">
        {/* Back button */}
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" onClick={() => { setViewMode('list'); setSelectedPart(null) }} className="gap-1.5">
            <ChevronLeft className="h-4 w-4" />
            Voltar ao Estoque
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => handleOpenMovement(selectedPart.id)} className="gap-1.5">
              <ArrowUpDown className="h-4 w-4" />
              Movimentação
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleOpenEditPart(selectedPart)} className="gap-1.5">
              <Edit className="h-4 w-4" />
              Editar
            </Button>
          </div>
        </div>

        {/* Part info card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5 text-emerald-600" />
                {selectedPart.sku} — {selectedPart.description}
              </CardTitle>
              {getStockBadge(selectedPart)}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              <InfoItem label="SKU" value={selectedPart.sku} />
              <InfoItem label="Descrição" value={selectedPart.description} />
              <InfoItem label="NCM" value={selectedPart.ncm} />
              <InfoItem label="CFOP" value={selectedPart.cfop} />
              <InfoItem label="Unidade" value={selectedPart.unit} />
              <InfoItem label="Quantidade" value={String(selectedPart.quantity)} highlight />
              <InfoItem label="Qtd Mínima" value={String(selectedPart.minQuantity)} />
              <InfoItem label="Preço Custo" value={formatCurrency(selectedPart.costPrice)} />
              <InfoItem label="Preço Venda" value={formatCurrency(selectedPart.salePrice)} />
              <InfoItem label="Localização" value={selectedPart.location} />
              <InfoItem label="Lote" value={selectedPart.batch} />
              <InfoItem label="Validade" value={formatDate(selectedPart.validity)} />
              <InfoItem label="CST" value={selectedPart.cst} />
              <InfoItem label="CSOSN" value={selectedPart.csosn} />
              <InfoItem
                label="Fornecedor"
                value={selectedPart.supplier?.nomeFantasia || selectedPart.supplier?.razaoSocial}
              />
            </div>
          </CardContent>
        </Card>

        {/* Movement history */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Histórico de Movimentações</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {partMovements.length === 0 ? (
              <div className="flex items-center justify-center py-10 text-zinc-500">
                <p>Nenhuma movimentação registrada</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tipo</TableHead>
                      <TableHead className="text-center">Quantidade</TableHead>
                      <TableHead className="text-right">Custo Unit.</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Referência</TableHead>
                      <TableHead className="text-right">Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {partMovements.map((mov) => (
                      <TableRow key={mov.id}>
                        <TableCell>
                          {mov.type === 'ENTRADA' ? (
                            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 gap-1">
                              <TrendingUp className="h-3 w-3" /> Entrada
                            </Badge>
                          ) : (
                            <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100 gap-1">
                              <TrendingDown className="h-3 w-3" /> Saída
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-center font-medium">{mov.quantity}</TableCell>
                        <TableCell className="text-right">{formatCurrency(mov.unitCost)}</TableCell>
                        <TableCell className="max-w-[150px] truncate">{mov.reason || '—'}</TableCell>
                        <TableCell className="max-w-[120px] truncate">{mov.reference || '—'}</TableCell>
                        <TableCell className="text-right text-sm text-zinc-500">{formatDate(mov.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stock Movement Dialog (shared from list view) */}
        <Dialog open={showMovementDialog} onOpenChange={setShowMovementDialog}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <ArrowUpDown className="h-5 w-5 text-emerald-600" />
                Movimentação de Estoque
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Peça *</Label>
                <Select value={movementForm.partId} onValueChange={(v) => setMovementForm({ ...movementForm, partId: v })}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione a peça" />
                  </SelectTrigger>
                  <SelectContent>
                    {parts.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.sku} — {p.description}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Tipo *</Label>
                <Select value={movementForm.type} onValueChange={(v) => setMovementForm({ ...movementForm, type: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ENTRADA">
                      <span className="flex items-center gap-2">
                        <TrendingUp className="h-4 w-4 text-emerald-600" /> ENTRADA
                      </span>
                    </SelectItem>
                    <SelectItem value="SAIDA">
                      <span className="flex items-center gap-2">
                        <TrendingDown className="h-4 w-4 text-red-500" /> SAÍDA
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Quantidade *</Label>
                  <Input
                    type="number"
                    min={1}
                    value={movementForm.quantity}
                    onChange={(e) => setMovementForm({ ...movementForm, quantity: parseFloat(e.target.value) || 0 })}
                  />
                </div>
                {movementForm.type === 'ENTRADA' && (
                  <div className="space-y-2">
                    <Label>Custo Unitário (R$)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={movementForm.unitCost}
                      onChange={(e) => setMovementForm({ ...movementForm, unitCost: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <Label>Motivo</Label>
                <Input
                  placeholder="Ex: Compra, Ajuste, etc."
                  value={movementForm.reason}
                  onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label>Referência</Label>
                <Input
                  placeholder="Ex: NF 12345, OS 0042"
                  value={movementForm.reference}
                  onChange={(e) => setMovementForm({ ...movementForm, reference: e.target.value })}
                />
              </div>
              {movementForm.partId && (
                <Card className="bg-zinc-50 dark:bg-zinc-900">
                  <CardContent className="p-4">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-zinc-500">Estoque atual</p>
                        <p className="font-bold text-lg">{getCurrentStock()}</p>
                      </div>
                      <div>
                        <p className="text-zinc-500">Estoque projetado</p>
                        <p className={`font-bold text-lg ${
                          (getProjectedStock() ?? 0) < 0
                            ? 'text-red-600'
                            : (getProjectedStock() ?? 0) === 0
                              ? 'text-orange-500'
                              : 'text-emerald-600'
                        }`}>
                          {getProjectedStock() ?? '—'}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowMovementDialog(false)}>
                Cancelar
              </Button>
              <Button
                onClick={handleSaveMovement}
                disabled={savingMovement || !movementForm.partId || movementForm.quantity <= 0}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {savingMovement && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Registrar Movimentação
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Part Dialog (shared) */}
        <Dialog open={showPartDialog} onOpenChange={setShowPartDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Package className="h-5 w-5 text-emerald-600" />
                Editar Peça
              </DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="sku-d">SKU *</Label>
                <Input id="sku-d" value={partForm.sku} onChange={(e) => setPartForm({ ...partForm, sku: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="desc-d">Descrição *</Label>
                <Input id="desc-d" value={partForm.description} onChange={(e) => setPartForm({ ...partForm, description: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ncm-d">NCM</Label>
                <Input id="ncm-d" value={partForm.ncm} onChange={(e) => setPartForm({ ...partForm, ncm: maskNCM(e.target.value) })} maxLength={10} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cfop-d">CFOP</Label>
                <Input id="cfop-d" value={partForm.cfop} onChange={(e) => setPartForm({ ...partForm, cfop: maskCFOP(e.target.value) })} maxLength={4} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit-d">Unidade</Label>
                <Select value={partForm.unit} onValueChange={(v) => setPartForm({ ...partForm, unit: v })}>
                  <SelectTrigger id="unit-d"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UN">UN</SelectItem><SelectItem value="PC">PC</SelectItem>
                    <SelectItem value="KG">KG</SelectItem><SelectItem value="LT">LT</SelectItem>
                    <SelectItem value="MT">MT</SelectItem><SelectItem value="CX">CX</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier-d">Fornecedor</Label>
                <Select value={partForm.supplierId} onValueChange={(v) => setPartForm({ ...partForm, supplierId: v })}>
                  <SelectTrigger id="supplier-d"><SelectValue placeholder="Selecione" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Nenhum</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.nomeFantasia || s.razaoSocial}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Separator className="col-span-full" />
              <div className="space-y-2">
                <Label>Qtd Mínima</Label>
                <Input type="number" min={0} value={partForm.minQuantity} onChange={(e) => setPartForm({ ...partForm, minQuantity: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="space-y-2">
                <Label>Preço Custo (R$)</Label>
                <Input type="number" min={0} step={0.01} value={partForm.costPrice} onChange={(e) => setPartForm({ ...partForm, costPrice: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="space-y-2">
                <Label>Preço Venda (R$)</Label>
                <Input type="number" min={0} step={0.01} value={partForm.salePrice} onChange={(e) => setPartForm({ ...partForm, salePrice: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="space-y-2">
                <Label>Localização</Label>
                <Input value={partForm.location} onChange={(e) => setPartForm({ ...partForm, location: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Lote</Label>
                <Input value={partForm.batch} onChange={(e) => setPartForm({ ...partForm, batch: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Validade</Label>
                <Input type="date" value={partForm.validity} onChange={(e) => setPartForm({ ...partForm, validity: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>CST</Label>
                <Input value={partForm.cst} onChange={(e) => setPartForm({ ...partForm, cst: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>CSOSN</Label>
                <Input value={partForm.csosn} onChange={(e) => setPartForm({ ...partForm, csosn: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowPartDialog(false)}>Cancelar</Button>
              <Button onClick={handleSavePart} disabled={saving || !partForm.sku.trim() || !partForm.description.trim()} className="bg-emerald-600 hover:bg-emerald-700">
                {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Salvar Alterações
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  // =============================================
  // RENDER: ALERTS VIEW
  // =============================================
  return (
    <div className="space-y-4">
      {/* Back button */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={() => setViewMode('list')} className="gap-1.5">
          <ChevronLeft className="h-4 w-4" />
          Voltar ao Estoque
        </Button>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={handlePrintAlerts} disabled={alerts.length === 0} className="gap-1.5 border-emerald-200 text-emerald-700 hover:bg-emerald-50">
            <Printer className="h-4 w-4" />
            Imprimir Alertas
          </Button>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-orange-500" />
            Alertas de Estoque
          </h1>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-red-200 bg-red-50 dark:bg-red-950/20 dark:border-red-900">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-red-100 dark:bg-red-900/50 p-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <p className="text-sm text-red-600 font-medium">Crítico</p>
              <p className="text-2xl font-bold text-red-700">{alertsSummary.critical}</p>
              <p className="text-xs text-red-500">Estoque zerado</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-900">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-orange-100 dark:bg-orange-900/50 p-2">
              <AlertTriangle className="h-5 w-5 text-orange-500" />
            </div>
            <div>
              <p className="text-sm text-orange-600 font-medium">Atenção</p>
              <p className="text-2xl font-bold text-orange-700">{alertsSummary.warning}</p>
              <p className="text-xs text-orange-500">Abaixo do mínimo</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-zinc-200 bg-zinc-50 dark:bg-zinc-900 dark:border-zinc-800">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="rounded-full bg-zinc-100 dark:bg-zinc-800 p-2">
              <Package className="h-5 w-5 text-zinc-600" />
            </div>
            <div>
              <p className="text-sm text-zinc-600 font-medium">Total</p>
              <p className="text-2xl font-bold text-zinc-700">{alertsSummary.total}</p>
              <p className="text-xs text-zinc-500">Itens em alerta</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Alerts table */}
      <Card>
        <CardContent className="p-0">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-500">
              <Package className="h-12 w-12 mb-3 opacity-40" />
              <p className="text-lg font-medium">Nenhum alerta de estoque</p>
              <p className="text-sm">Todos os itens estão com estoque adequado</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Severidade</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-center">Atual</TableHead>
                    <TableHead className="text-center">Mínimo</TableHead>
                    <TableHead className="text-center">Déficit</TableHead>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map((alert) => (
                    <TableRow key={alert.id}>
                      <TableCell>
                        {alert.severity === 'CRITICAL' ? (
                          <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">CRÍTICO</Badge>
                        ) : (
                          <Badge className="bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100">ATENÇÃO</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{alert.sku}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{alert.description}</TableCell>
                      <TableCell className="text-center font-medium">
                        <span className={alert.currentQuantity === 0 ? 'text-red-600 font-bold' : 'text-orange-600'}>
                          {alert.currentQuantity}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-zinc-500">{alert.minQuantity}</TableCell>
                      <TableCell className="text-center font-medium text-red-600">-{alert.deficit}</TableCell>
                      <TableCell className="max-w-[120px] truncate">
                        {alert.supplier?.name || '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleOpenMovement(alert.id)}
                          className="gap-1 text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                        >
                          <TrendingUp className="h-3.5 w-3.5" />
                          Entrada
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Stock Movement Dialog (for alerts quick entry) */}
      <Dialog open={showMovementDialog} onOpenChange={setShowMovementDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ArrowUpDown className="h-5 w-5 text-emerald-600" />
              Movimentação de Estoque
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Peça *</Label>
              <Select value={movementForm.partId} onValueChange={(v) => setMovementForm({ ...movementForm, partId: v })}>
                <SelectTrigger><SelectValue placeholder="Selecione a peça" /></SelectTrigger>
                <SelectContent>
                  {parts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.sku} — {p.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Tipo *</Label>
              <Select value={movementForm.type} onValueChange={(v) => setMovementForm({ ...movementForm, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ENTRADA">
                    <span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-600" /> ENTRADA</span>
                  </SelectItem>
                  <SelectItem value="SAIDA">
                    <span className="flex items-center gap-2"><TrendingDown className="h-4 w-4 text-red-500" /> SAÍDA</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Quantidade *</Label>
                <Input type="number" min={1} value={movementForm.quantity} onChange={(e) => setMovementForm({ ...movementForm, quantity: parseFloat(e.target.value) || 0 })} />
              </div>
              {movementForm.type === 'ENTRADA' && (
                <div className="space-y-2">
                  <Label>Custo Unitário (R$)</Label>
                  <Input type="number" min={0} step={0.01} value={movementForm.unitCost} onChange={(e) => setMovementForm({ ...movementForm, unitCost: parseFloat(e.target.value) || 0 })} />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>Motivo</Label>
              <Input placeholder="Ex: Compra, Ajuste, etc." value={movementForm.reason} onChange={(e) => setMovementForm({ ...movementForm, reason: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Referência</Label>
              <Input placeholder="Ex: NF 12345, OS 0042" value={movementForm.reference} onChange={(e) => setMovementForm({ ...movementForm, reference: e.target.value })} />
            </div>
            {movementForm.partId && (
              <Card className="bg-zinc-50 dark:bg-zinc-900">
                <CardContent className="p-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-zinc-500">Estoque atual</p>
                      <p className="font-bold text-lg">{getCurrentStock()}</p>
                    </div>
                    <div>
                      <p className="text-zinc-500">Estoque projetado</p>
                      <p className={`font-bold text-lg ${
                        (getProjectedStock() ?? 0) < 0 ? 'text-red-600' : (getProjectedStock() ?? 0) === 0 ? 'text-orange-500' : 'text-emerald-600'
                      }`}>
                        {getProjectedStock() ?? '—'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowMovementDialog(false)}>Cancelar</Button>
            <Button onClick={handleSaveMovement} disabled={savingMovement || !movementForm.partId || movementForm.quantity <= 0} className="bg-emerald-600 hover:bg-emerald-700">
              {savingMovement && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Registrar Movimentação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// =============================================
// INFO ITEM SUBCOMPONENT
// =============================================
function InfoItem({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  return (
    <div>
      <p className="text-xs text-zinc-500 mb-0.5">{label}</p>
      <p className={`text-sm font-medium ${highlight ? 'text-emerald-600 text-lg' : 'text-zinc-900 dark:text-zinc-100'}`}>
        {value || '—'}
      </p>
    </div>
  )
}
