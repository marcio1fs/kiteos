'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { maskCNPJ, maskNCM, maskCFOP, validateCNPJ, validateNCM, validateCFOP } from '@/lib/validators'
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Upload,
  FileText,
  CheckCircle2,
  XCircle,
  Plus,
  Eye,
  ClipboardCheck,
  Package,
  DollarSign,
  Ban,
  Search,
  AlertTriangle,
  AlertCircle,
  Info,
  Trash2,
  RefreshCw,
  Loader2,
  Send,
  Globe,
  Calculator,
  ShieldCheck,
  Percent,
  BookOpen,
  Layers,
  ArrowUpRight,
  ArrowDownLeft,
  FileSpreadsheet,
} from 'lucide-react'
import { ClientInvoiceDoc, type ClientInvoiceData } from '@/components/modules/client-invoice-doc'
import { SefazModule } from '@/components/modules/sefaz'

// ==================== TYPES ====================
interface InvoiceItem {
  id: string
  sku: string | null
  descricao: string
  ncm: string
  cfop: string
  cst: string | null
  csosn: string | null
  quantidade: number
  unidade: string
  valorUnitario: number
  valorTotal: number
  baseIcms: number
  valorIcms: number
  valorIpi: number
  valorPis: number
  valorCofins: number
  lote: string | null
  validade: string | null
  localizacao: string | null
  divergencia: boolean
  partId: string | null
}

interface Supplier {
  id: string
  cnpj: string
  razaoSocial: string
}

interface Reception {
  id: string
  status: string
  divergencia: string | null
  quantidadeRecebida: number | null
}

interface Invoice {
  id: string
  chave: string
  numero: string
  serie: string
  tipoOperacao: string
  dataEmissao: string
  dataEntrada: string | null
  subtotal: number
  frete: number
  seguro: number
  desconto: number
  baseIcms: number
  valorIcms: number
  valorIpi: number
  valorPis: number
  valorCofins: number
  totalNf: number
  status: string
  observacao: string | null
  supplierId: string
  supplier: Supplier
  items: InvoiceItem[]
  reception: Reception | null
}

interface ValidationData {
  valid: boolean
  errors: string[]
  warnings: string[]
  summary: {
    totalErrors: number
    totalWarnings: number
    itemsChecked: number
    itemsWithoutSku: number
  }
}

const STATUS_CONFIG: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; className: string }> = {
  IMPORTADA: { label: 'Importada', variant: 'secondary', className: 'bg-blue-100 text-blue-800 hover:bg-blue-100' },
  CONFERIDA: { label: 'Conferida', variant: 'secondary', className: 'bg-green-100 text-green-800 hover:bg-green-100' },
  DIVERGENTE: { label: 'Divergente', variant: 'secondary', className: 'bg-orange-100 text-orange-800 hover:bg-orange-100' },
  ESTOQUE_ATUALIZADO: { label: 'Estoque Atualizado', variant: 'secondary', className: 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100' },
  PAGA: { label: 'Paga', variant: 'secondary', className: 'bg-green-100 text-green-800 hover:bg-green-100' },
}

function formatCurrency(value: number | string | null | undefined) {
  if (value === null || value === undefined) return 'R$ 0,00'
  const num = typeof value === 'number' ? value : parseFloat(String(value))
  if (isNaN(num)) return 'R$ 0,00'
  return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleDateString('pt-BR')
}

function formatCnpj(cnpj: string) {
  return cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

function maskChave(value: string) {
  return value.replace(/\D/g, '').slice(0, 44)
}

// ==================== MAIN COMPONENT ====================
export function NFeModule() {
  const { office, user } = useAuthStore()
  const officeId = office?.id

  // State
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [searchTerm, setSearchTerm] = useState('')

  // Import state
  const [chaveInput, setChaveInput] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: boolean; message: string; warnings?: string[] } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  // Validation state
  const [validating, setValidating] = useState(false)
  const [validationData, setValidationData] = useState<ValidationData | null>(null)

  // Detail dialog
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)

  // Conference dialog
  const [conferenceOpen, setConferenceOpen] = useState(false)
  const [conferenceQuantities, setConferenceQuantities] = useState<Record<string, number>>({})
  const [conferencing, setConferencing] = useState(false)

  // Manual NF dialog
  const [manualOpen, setManualOpen] = useState(false)
  const [manualSaving, setManualSaving] = useState(false)
  const [manualForm, setManualForm] = useState({
    chave: '', numero: '', serie: '1', tipoOperacao: 'ENTRADA', tipoDocumento: 'NFE',
    dataEmissao: new Date().toISOString().split('T')[0],
    supplierCnpj: '', supplierRazaoSocial: '',
    frete: 0, seguro: 0, desconto: 0, observacao: '',
  })
  const [manualItems, setManualItems] = useState<Array<{
    partId?: string; sku: string; descricao: string; ncm: string; cfop: string;
    quantidade: number; unidade: string; valorUnitario: number; valorTotal: number;
    baseIcms: number; valorIcms: number; valorIpi: number; valorPis: number; valorCofins: number;
    lote: string; localizacao: string;
  }>>([
    { partId: '', sku: '', descricao: '', ncm: '', cfop: '1102', quantidade: 1, unidade: 'UN', valorUnitario: 0, valorTotal: 0, baseIcms: 0, valorIcms: 0, valorIpi: 0, valorPis: 0, valorCofins: 0, lote: '', localizacao: '' },
  ])

  // ---- Product Search Modal for Manual Entry / Receipt Grid ----
  const [productSearchOpen, setProductSearchOpen] = useState(false)
  const [productSearchQuery, setProductSearchQuery] = useState('')
  const [targetItemIndex, setTargetItemIndex] = useState<number | null>(null)
  const [registeredParts, setRegisteredParts] = useState<Array<{
    id: string
    sku: string
    description: string
    ncm?: string | null
    cfop?: string | null
    unit: string
    quantity: number
    costPrice: number
    salePrice: number
    location?: string | null
  }>>([])
  const [loadingParts, setLoadingParts] = useState(false)

  const openProductSearchModal = async (targetIndex: number | null = null) => {
    setTargetItemIndex(targetIndex)
    setProductSearchQuery('')
    setProductSearchOpen(true)
    if (officeId) {
      setLoadingParts(true)
      try {
        const res = await apiFetch(`/api/parts?officeId=${officeId}&limit=200`)
        if (res.success && Array.isArray(res.data)) {
          setRegisteredParts(res.data)
        }
      } catch {
        // Silently handle
      } finally {
        setLoadingParts(false)
      }
    }
  }

  const selectProductForManualEntry = (part: {
    id: string
    sku: string
    description: string
    ncm?: string | null
    cfop?: string | null
    unit: string
    costPrice: number
  }) => {
    const cost = Number(part.costPrice || 0)
    if (targetItemIndex !== null && targetItemIndex >= 0 && targetItemIndex < manualItems.length) {
      setManualItems(prev => {
        const updated = [...prev]
        const currentQty = updated[targetItemIndex].quantidade || 1
        updated[targetItemIndex] = {
          ...updated[targetItemIndex],
          partId: part.id,
          sku: part.sku || '',
          descricao: part.description || '',
          ncm: part.ncm || '',
          cfop: part.cfop || '1102',
          unidade: part.unit || 'UN',
          valorUnitario: cost,
          valorTotal: currentQty * cost,
        }
        return updated
      })
    } else {
      setManualItems(prev => [
        ...prev,
        {
          partId: part.id,
          sku: part.sku || '',
          descricao: part.description || '',
          ncm: part.ncm || '',
          cfop: part.cfop || '1102',
          quantidade: 1,
          unidade: part.unit || 'UN',
          valorUnitario: cost,
          valorTotal: cost,
          baseIcms: 0,
          valorIcms: 0,
          valorIpi: 0,
          valorPis: 0,
          valorCofins: 0,
          lote: '',
          localizacao: '',
        },
      ])
    }
    setProductSearchOpen(false)
  }

  // Alert state
  const [alerts, setAlerts] = useState<Array<{ type: 'error' | 'warning' | 'info'; message: string }>>([])

  // ---- Pricing & Profit Margin Modal state ----
  const [pricingOpen, setPricingOpen] = useState(false)
  const [pricingInvoice, setPricingInvoice] = useState<Invoice | null>(null)
  const [pricingItems, setPricingItems] = useState<Array<{
    itemId: string
    partId: string | null
    sku: string
    descricao: string
    unidade: string
    quantidade: number
    custoAtual: number
    precoVendaAtual: number
    margemLucroPct: number
    novoPrecoVenda: number
    lucroBrutoUnit: number
  }>>([])
  const [globalMarginInput, setGlobalMarginInput] = useState<string>('40')
  const [savingPricing, setSavingPricing] = useState(false)

  // Client Invoices (Notas Emitidas) state
  const [clientInvoices, setClientInvoices] = useState<Array<ClientInvoiceData>>([])
  const [clientInvoicesLoading, setClientInvoicesLoading] = useState(false)
  const [showClientInvoiceDoc, setShowClientInvoiceDoc] = useState(false)
  const [selectedClientInvoice, setSelectedClientInvoice] = useState<ClientInvoiceData | null>(null)
  const [activeTab, setActiveTab] = useState('importar')
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false)
  const [cancelInvoiceId, setCancelInvoiceId] = useState<string | null>(null)
  const [cancelMotivo, setCancelMotivo] = useState('')
  const [cancelLoading, setCancelLoading] = useState(false)

  // Action loading states
  const [updatingStock, setUpdatingStock] = useState(false)
  const [generatingTitulo, setGeneratingTitulo] = useState(false)

  // Item mapping state (itemId → partId)
  const [itemPartMap, setItemPartMap] = useState<Record<string, string | null>>({})
  const [partSearchTerm, setPartSearchTerm] = useState<Record<string, string>>({})
  const [partSearchResults, setPartSearchResults] = useState<Record<string, Array<{ id: string; sku: string; description: string; quantity: number; salePrice: number }>>>({})
  const [partSearchLoading, setPartSearchLoading] = useState<Record<string, boolean>>({})

  // New part dialog
  const [newPartDialogOpen, setNewPartDialogOpen] = useState(false)
  const [newPartForItem, setNewPartForItem] = useState<string | null>(null)
  const [newPartForm, setNewPartForm] = useState({ sku: '', description: '', ncm: '', unit: 'UN', costPrice: 0, salePrice: 0, minQuantity: 0 })
  const [newPartSaving, setNewPartSaving] = useState(false)

  // ---- Tax Rules State ----
  const [taxRules, setTaxRules] = useState<Array<{
    id: string
    ncm: string
    cfop: string
    cst: string | null
    csosn: string | null
    aliqIcms: number
    aliqIpi: number
    aliqPis: number
    aliqCofins: number
    state: string
    active: boolean
  }>>([])
  const [taxRulesLoading, setTaxRulesLoading] = useState(false)
  const [taxRuleSearch, setTaxRuleSearch] = useState('')
  const [newTaxRuleOpen, setNewTaxRuleOpen] = useState(false)
  const [newTaxRuleSaving, setNewTaxRuleSaving] = useState(false)
  const [newTaxRuleForm, setNewTaxRuleForm] = useState({
    ncm: '',
    cfop: '5102',
    cst: '',
    csosn: '102',
    aliqIcms: 18,
    aliqIpi: 0,
    aliqPis: 1.65,
    aliqCofins: 7.6,
    state: 'BA',
  })

  // ---- Tax Simulator State ----
  const [simType, setSimType] = useState<'PRODUTO' | 'SERVICO'>('PRODUTO')
  const [simValor, setSimValor] = useState<number>(1000)
  const [simAliqIcms, setSimAliqIcms] = useState<number>(18)
  const [simAliqIpi, setSimAliqIpi] = useState<number>(0)
  const [simAliqPis, setSimAliqPis] = useState<number>(1.65)
  const [simAliqCofins, setSimAliqCofins] = useState<number>(7.6)
  const [simAliqIssqn, setSimAliqIssqn] = useState<number>(5)

  const fetchTaxRules = useCallback(async () => {
    if (!officeId) return
    setTaxRulesLoading(true)
    try {
      const res = await apiFetch(`/api/tax-rules?limit=100`)
      if (res.success && res.data?.rules) {
        setTaxRules(res.data.rules)
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro ao carregar regras fiscais' }])
    } finally {
      setTaxRulesLoading(false)
    }
  }, [officeId])

  const handleCreateTaxRule = async () => {
    if (!officeId) return
    if (!newTaxRuleForm.ncm || !newTaxRuleForm.cfop) {
      setAlerts(prev => [...prev, { type: 'error', message: 'NCM e CFOP são obrigatórios' }])
      return
    }
    setNewTaxRuleSaving(true)
    try {
      const res = await apiFetch('/api/tax-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newTaxRuleForm),
      })
      if (res.success) {
        setAlerts(prev => [...prev, { type: 'info', message: 'Regra fiscal criada com sucesso!' }])
        setNewTaxRuleOpen(false)
        setNewTaxRuleForm({ ncm: '', cfop: '5102', cst: '', csosn: '102', aliqIcms: 18, aliqIpi: 0, aliqPis: 1.65, aliqCofins: 7.6, state: 'BA' })
        fetchTaxRules()
      } else {
        setAlerts(prev => [...prev, { type: 'error', message: res.errors?.join(', ') || 'Erro ao criar regra fiscal' }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro de conexão ao salvar regra fiscal' }])
    } finally {
      setNewTaxRuleSaving(false)
    }
  }

  // ---- Part Search for Item Mapping ----
  const searchPartsForItem = useCallback(async (itemId: string, term: string) => {
    if (!officeId || !term.trim()) {
      setPartSearchResults(prev => ({ ...prev, [itemId]: [] }))
      return
    }
    setPartSearchLoading(prev => ({ ...prev, [itemId]: true }))
    try {
      const params = new URLSearchParams({ officeId, search: term, limit: '10' })
      const res = await apiFetch(`/api/parts?${params.toString()}`)
      if (res.success) {
        setPartSearchResults(prev => ({ ...prev, [itemId]: res.data.filter((p: { deleted?: boolean }) => !p.deleted) }))
      }
    } catch {
      setPartSearchResults(prev => ({ ...prev, [itemId]: [] }))
    } finally {
      setPartSearchLoading(prev => ({ ...prev, [itemId]: false }))
    }
  }, [officeId])

  const handlePartSearchDebounce = useRef<NodeJS.Timeout | null>(null)
  const handlePartSearch = (itemId: string, term: string) => {
    setPartSearchTerm(prev => ({ ...prev, [itemId]: term }))
    if (handlePartSearchDebounce.current) clearTimeout(handlePartSearchDebounce.current)
    handlePartSearchDebounce.current = setTimeout(() => searchPartsForItem(itemId, term), 300)
  }

  const selectPartForItem = (itemId: string, partId: string) => {
    setItemPartMap(prev => ({ ...prev, [itemId]: partId }))
    setPartSearchTerm(prev => ({ ...prev, [itemId]: '' }))
    setPartSearchResults(prev => ({ ...prev, [itemId]: [] }))
  }

  const unmapItemPart = (itemId: string) => {
    setItemPartMap(prev => ({ ...prev, [itemId]: null }))
  }

  // ---- New Part Creation from NF-e Item ----
  const openNewPartDialog = (itemId: string) => {
    const item = selectedInvoice?.items.find(i => i.id === itemId)
    if (!item) return
    setNewPartForItem(itemId)
    setNewPartForm({
      sku: item.sku || '',
      description: item.descricao,
      ncm: item.ncm,
      unit: item.unidade,
      costPrice: item.valorUnitario,
      salePrice: Math.round(item.valorUnitario * 1.4 * 100) / 100,
      minQuantity: 0,
    })
    setNewPartDialogOpen(true)
  }

  const handleSaveNewPart = async () => {
    if (!officeId || !newPartForItem) return
    if (!newPartForm.sku || !newPartForm.description) {
      setAlerts(prev => [...prev, { type: 'error', message: 'SKU e descrição são obrigatórios' }])
      return
    }
    setNewPartSaving(true)
    try {
      const res = await apiFetch('/api/parts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officeId, ...newPartForm, quantity: 0 }),
      })
      if (res.success) {
        setItemPartMap(prev => ({ ...prev, [newPartForItem!]: res.data.id }))
        setNewPartDialogOpen(false)
        setAlerts(prev => [...prev, { type: 'info', message: `Peça "${newPartForm.description}" cadastrada com sucesso!` }])
      } else {
        setAlerts(prev => [...prev, { type: 'error', message: res.error || 'Erro ao cadastrar peça' }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro de conexão ao cadastrar peça' }])
    } finally {
      setNewPartSaving(false)
    }
  }

  // ---- Save Item Mappings to Backend ----
  const handleSaveMappings = async () => {
    if (!selectedInvoice || !officeId) return
    const mappings = Object.entries(itemPartMap).filter(([_, partId]) => partId)
    if (mappings.length === 0) {
      setAlerts(prev => [...prev, { type: 'warning', message: 'Nenhum item foi mapeado para o estoque' }])
      return
    }
    try {
      // Update each InvoiceItem with its partId
      for (const [itemId, partId] of mappings) {
        if (partId) {
          await apiFetch(`/api/nfe/${selectedInvoice.id}/items/${itemId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ officeId, partId }),
          })
        }
      }
      setAlerts(prev => [...prev, { type: 'info', message: `${mappings.length} item(ns) mapeado(s) para o estoque!` }])
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro ao salvar mapeamentos' }])
    }
  }

  const fetchInvoices = useCallback(async () => {
    if (!officeId) return
    setLoading(true)
    try {
      const res = await apiFetch(`/api/nfe?officeId=${officeId}`)
      if (res.success) {
        setInvoices(res.data || [])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro ao carregar notas fiscais' }])
    } finally {
      setLoading(false)
    }
  }, [officeId])

  useEffect(() => {
    fetchInvoices()
  }, [fetchInvoices])

  // Auto-dismiss alerts
  useEffect(() => {
    if (alerts.length === 0) return
    const timer = setTimeout(() => setAlerts(prev => prev.slice(1)), 6000)
    return () => clearTimeout(timer)
  }, [alerts])

  // ---- Import XML ----
  const handleXmlUpload = async (file: File) => {
    if (!officeId) return
    setImporting(true)
    setImportResult(null)
    try {
      const formData = new FormData()
      formData.append('xml', file)
      formData.append('officeId', officeId)
      formData.append('userId', user?.id || '')

      const token = localStorage.getItem('kiteos_token')
      const res = await fetch('/api/nfe/import', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      })
      const data = await res.json()

      if (data.success) {
        setImportResult({ success: true, message: 'NF-e importada com sucesso!', warnings: data.warnings })
        if (data.warnings?.length) {
          data.warnings.forEach((w: string) => setAlerts(prev => [...prev, { type: 'warning', message: w }]))
        }
        fetchInvoices()
      } else {
        const errorMsg = data.errors?.join(', ') || 'Erro ao importar XML'
        setImportResult({ success: false, message: errorMsg })
        if (res.status === 409) {
          setAlerts(prev => [...prev, { type: 'error', message: 'Nota fiscal duplicada!' }])
        }
      }
    } catch {
      setImportResult({ success: false, message: 'Erro de conexão ao importar XML' })
    } finally {
      setImporting(false)
    }
  }

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file && (file.name.endsWith('.xml') || file.type === 'text/xml' || file.type === 'application/xml')) {
      handleXmlUpload(file)
    } else {
      setAlerts(prev => [...prev, { type: 'error', message: 'Por favor, selecione um arquivo XML válido' }])
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleXmlUpload(file)
    e.target.value = ''
  }

  // ---- Validate ----
  const handleValidate = async (invoiceId: string) => {
    if (!officeId) return
    setValidating(true)
    setValidationData(null)
    try {
      const res = await apiFetch(`/api/nfe/${invoiceId}/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officeId }),
      })
      if (res.success) {
        setValidationData(res.data)
        if (!res.data.valid) {
          res.data.errors?.forEach((err: string) => setAlerts(prev => [...prev, { type: 'error', message: err }]))
        }
        res.data.warnings?.forEach((w: string) => setAlerts(prev => [...prev, { type: 'warning', message: w }]))
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro ao validar NF-e' }])
    } finally {
      setValidating(false)
    }
  }

  // ---- Detail ----
  const openDetail = async (invoice: Invoice) => {
    setSelectedInvoice(invoice)
    setDetailOpen(true)
    setValidationData(null)
    setDetailLoading(true)
    try {
      const res = await apiFetch(`/api/nfe/${invoice.id}?officeId=${officeId}`)
      if (res.success) {
        setSelectedInvoice(res.data)
        // Initialize itemPartMap from existing partId values on items
        const existingMap: Record<string, string | null> = {}
        res.data.items.forEach((item: InvoiceItem) => {
          existingMap[item.id] = item.partId || null
        })
        setItemPartMap(existingMap)
      }
    } catch {
      // use cached data
    } finally {
      setDetailLoading(false)
    }
  }

  // ---- Conference ----
  const openConference = (invoice: Invoice) => {
    const qtys: Record<string, number> = {}
    invoice.items.forEach(item => { qtys[item.id] = item.quantidade })
    setConferenceQuantities(qtys)
    setConferenceOpen(true)
  }

  const handleConference = async () => {
    if (!selectedInvoice || !officeId) return
    setConferencing(true)
    try {
      const conferencias = Object.entries(conferenceQuantities).map(([itemId, quantidadeRecebida]) => ({
        itemId,
        quantidadeRecebida,
      }))
      const res = await apiFetch(`/api/recebimento/${selectedInvoice.id}/conferir`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officeId, userId: user?.id, conferencias }),
      })
      if (res.success) {
        setConferenceOpen(false)
        const newStatus = res.data.receptionStatus
        if (newStatus === 'CONFERIDA') {
          setAlerts(prev => [...prev, { type: 'info', message: 'Recebimento conferido com sucesso!' }])
        } else if (newStatus === 'DIVERGENTE') {
          setAlerts(prev => [...prev, { type: 'warning', message: 'Divergência detectada no recebimento!' }])
        } else if (newStatus === 'BLOQUEADA') {
          setAlerts(prev => [...prev, { type: 'error', message: 'Divergência crítica! Recepção bloqueada.' }])
        }
        fetchInvoices()
        if (detailOpen) {
          const detail = await apiFetch(`/api/nfe/${selectedInvoice.id}?officeId=${officeId}`)
          if (detail.success) setSelectedInvoice(detail.data)
        }
      } else {
        setAlerts(prev => [...prev, { type: 'error', message: res.errors?.join(', ') || 'Erro ao conferir' }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro de conexão ao conferir' }])
    } finally {
      setConferencing(false)
    }
  }

  // ---- Stock Update ----
  const handleStockUpdate = async () => {
    if (!selectedInvoice || !officeId) return
    setUpdatingStock(true)
    try {
      const res = await apiFetch('/api/estoque/movimentar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officeId, userId: user?.id, invoiceId: selectedInvoice.id }),
      })
      if (res.success) {
        setAlerts(prev => [...prev, { type: 'info', message: 'Estoque atualizado com sucesso!' }])
        fetchInvoices()
        const detail = await apiFetch(`/api/nfe/${selectedInvoice.id}?officeId=${officeId}`)
        if (detail.success) {
          setSelectedInvoice(detail.data)
          openPricingModal(detail.data)
        }
      } else {
        setAlerts(prev => [...prev, { type: 'error', message: res.errors?.join(', ') || 'Erro ao atualizar estoque' }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro de conexão ao atualizar estoque' }])
    } finally {
      setUpdatingStock(false)
    }
  }

  // ---- Pricing & Margin Handlers ----
  const openPricingModal = async (invoice: Invoice) => {
    if (!officeId) return
    setPricingInvoice(invoice)
    setSavingPricing(false)
    setGlobalMarginInput('40')

    try {
      const res = await apiFetch(`/api/nfe/${invoice.id}?officeId=${officeId}`)
      const fullInvoice: Invoice = res.success ? res.data : invoice

      const partsRes = await apiFetch(`/api/parts?officeId=${officeId}&limit=500`)
      const partsList: Array<{ id: string; costPrice: number; salePrice: number; sku: string; description: string }> =
        partsRes.success && Array.isArray(partsRes.data) ? partsRes.data : []

      const itemsForPricing = fullInvoice.items.map((item: InvoiceItem) => {
        const linkedPart = item.partId ? partsList.find(p => p.id === item.partId) : null
        const custoUnit = Number(item.valorUnitario || 0)
        const precoVendaAtual = linkedPart ? Number(linkedPart.salePrice || 0) : (custoUnit > 0 ? Math.round(custoUnit * 1.4 * 100) / 100 : 0)

        let initialMarginPct = 40
        if (custoUnit > 0 && precoVendaAtual > custoUnit) {
          initialMarginPct = Math.round(((precoVendaAtual - custoUnit) / custoUnit) * 100 * 10) / 10
        }

        const novoPrecoVenda = Math.round(custoUnit * (1 + initialMarginPct / 100) * 100) / 100
        const lucroBrutoUnit = Math.round((novoPrecoVenda - custoUnit) * 100) / 100

        return {
          itemId: item.id,
          partId: item.partId || null,
          sku: item.sku || linkedPart?.sku || 'N/A',
          descricao: item.descricao || linkedPart?.description || 'Item sem descrição',
          unidade: item.unidade || 'UN',
          quantidade: item.quantidade,
          custoAtual: custoUnit,
          precoVendaAtual,
          margemLucroPct: initialMarginPct,
          novoPrecoVenda,
          lucroBrutoUnit,
        }
      })

      setPricingItems(itemsForPricing)
      setPricingOpen(true)
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro ao carregar dados para precificação.' }])
    }
  }

  const applyGlobalMargin = (marginValue: number) => {
    setPricingItems(prev =>
      prev.map(item => {
        const custo = item.custoAtual
        const margem = Math.max(0, marginValue)
        const novoPreco = Math.round(custo * (1 + margem / 100) * 100) / 100
        const lucro = Math.round((novoPreco - custo) * 100) / 100
        return {
          ...item,
          margemLucroPct: margem,
          novoPrecoVenda: novoPreco,
          lucroBrutoUnit: lucro,
        }
      })
    )
  }

  const updateItemMarginPct = (index: number, newMargin: number) => {
    setPricingItems(prev => {
      const updated = [...prev]
      const item = updated[index]
      const custo = item.custoAtual
      const margem = Math.max(0, newMargin)
      const novoPreco = Math.round(custo * (1 + margem / 100) * 100) / 100
      const lucro = Math.round((novoPreco - custo) * 100) / 100

      updated[index] = {
        ...item,
        margemLucroPct: margem,
        novoPrecoVenda: novoPreco,
        lucroBrutoUnit: lucro,
      }
      return updated
    })
  }

  const updateItemSalePrice = (index: number, newPrice: number) => {
    setPricingItems(prev => {
      const updated = [...prev]
      const item = updated[index]
      const custo = item.custoAtual
      const preco = Math.max(0, newPrice)
      const margem = custo > 0 ? Math.round(((preco - custo) / custo) * 100 * 10) / 10 : 0
      const lucro = Math.round((preco - custo) * 100) / 100

      updated[index] = {
        ...item,
        margemLucroPct: margem,
        novoPrecoVenda: preco,
        lucroBrutoUnit: lucro,
      }
      return updated
    })
  }

  const handleSavePricing = async () => {
    if (!officeId || !pricingInvoice) return
    setSavingPricing(true)
    try {
      const itemsToUpdate = pricingItems
        .filter(item => item.partId && item.novoPrecoVenda > 0)
        .map(item => ({
          partId: item.partId,
          costPrice: item.custoAtual,
          salePrice: item.novoPrecoVenda,
        }))

      if (itemsToUpdate.length === 0) {
        setAlerts(prev => [...prev, { type: 'warning', message: 'Nenhum item vinculado a um produto do estoque para atualizar preço.' }])
        setPricingOpen(false)
        return
      }

      const res = await apiFetch('/api/parts/batch-pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId,
          invoiceId: pricingInvoice.id,
          items: itemsToUpdate,
        }),
      })

      if (res.success) {
        setAlerts(prev => [...prev, { type: 'info', message: 'Preços de venda e margens de lucro atualizados no estoque!' }])
        setPricingOpen(false)
        fetchInvoices()
      } else {
        setAlerts(prev => [...prev, { type: 'error', message: res.errors?.join(', ') || 'Erro ao atualizar preços de venda.' }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro de conexão ao salvar precificação.' }])
    } finally {
      setSavingPricing(false)
    }
  }

  // ---- Generate Titulo ----
  const handleGenerateTitulo = async () => {
    if (!selectedInvoice || !officeId) return
    setGeneratingTitulo(true)
    try {
      const res = await apiFetch('/api/financeiro/titulo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officeId, userId: user?.id, invoiceId: selectedInvoice.id }),
      })
      if (res.success) {
        setAlerts(prev => [...prev, { type: 'info', message: 'Título a pagar gerado com sucesso!' }])
        fetchInvoices()
      } else {
        setAlerts(prev => [...prev, { type: 'error', message: res.errors?.join(', ') || 'Erro ao gerar título' }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro de conexão ao gerar título' }])
    } finally {
      setGeneratingTitulo(false)
    }
  }

  // ---- Manual NF ----
  const handleManualSave = async () => {
    if (!officeId) return
    // Validate CNPJ
    const cnpjError = validateCNPJ(manualForm.supplierCnpj)
    if (cnpjError) {
      setAlerts(prev => [...prev, { type: 'error', message: cnpjError }])
      return
    }
    // Validate NCM/CFOP in items
    for (let i = 0; i < manualItems.length; i++) {
      const ncmErr = validateNCM(manualItems[i].ncm)
      if (ncmErr) {
        setAlerts(prev => [...prev, { type: 'error', message: `Item ${i + 1}: ${ncmErr}` }])
        return
      }
      const cfopErr = validateCFOP(manualItems[i].cfop)
      if (cfopErr) {
        setAlerts(prev => [...prev, { type: 'error', message: `Item ${i + 1}: ${cfopErr}` }])
        return
      }
    }
    setManualSaving(true)
    try {
      const items = manualItems.map(item => ({
        ...item,
        valorTotal: item.quantidade * item.valorUnitario,
      }))
      const res = await apiFetch('/api/nfe/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId,
          userId: user?.id,
          ...manualForm,
          items,
        }),
      })
      if (res.success) {
        setManualOpen(false)
        setAlerts(prev => [...prev, { type: 'info', message: 'NF-e manual criada com sucesso!' }])
        resetManualForm()
        fetchInvoices()
      } else {
        setAlerts(prev => [...prev, { type: 'error', message: res.errors?.join(', ') || 'Erro ao criar NF-e manual' }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro de conexão' }])
    } finally {
      setManualSaving(false)
    }
  }

  const resetManualForm = () => {
    setManualForm({
      chave: '', numero: '', serie: '1', tipoOperacao: 'ENTRADA', tipoDocumento: 'NFE',
      dataEmissao: new Date().toISOString().split('T')[0],
      supplierCnpj: '', supplierRazaoSocial: '',
      frete: 0, seguro: 0, desconto: 0, observacao: '',
    })
    setManualItems([{ partId: '', sku: '', descricao: '', ncm: '', cfop: '1102', quantidade: 1, unidade: 'UN', valorUnitario: 0, valorTotal: 0, baseIcms: 0, valorIcms: 0, valorIpi: 0, valorPis: 0, valorCofins: 0, lote: '', localizacao: '' }])
  }

  const addManualItem = () => {
    setManualItems(prev => [...prev, { partId: '', sku: '', descricao: '', ncm: '', cfop: '1102', quantidade: 1, unidade: 'UN', valorUnitario: 0, valorTotal: 0, baseIcms: 0, valorIcms: 0, valorIpi: 0, valorPis: 0, valorCofins: 0, lote: '', localizacao: '' }])
  }

  const removeManualItem = (index: number) => {
    setManualItems(prev => prev.filter((_, i) => i !== index))
  }

  const updateManualItem = (index: number, field: string, value: string | number) => {
    setManualItems(prev => {
      const updated = [...prev]
      updated[index] = { ...updated[index], [field]: value }
      if (field === 'quantidade' || field === 'valorUnitario') {
        updated[index].valorTotal = updated[index].quantidade * updated[index].valorUnitario
      }
      return updated
    })
  }

  const manualSubtotal = manualItems.reduce((sum, item) => sum + item.quantidade * item.valorUnitario, 0)
  const manualTotal = manualSubtotal + manualForm.frete + manualForm.seguro - manualForm.desconto + manualItems.reduce((s, i) => s + i.valorIpi, 0)

  // ---- Filtered invoices ----
  const filteredInvoices = invoices.filter(inv => {
    if (statusFilter !== 'ALL' && inv.status !== statusFilter) return false
    if (searchTerm) {
      const term = searchTerm.toLowerCase()
      return (
        inv.chave.toLowerCase().includes(term) ||
        inv.numero.toLowerCase().includes(term) ||
        inv.supplier?.razaoSocial?.toLowerCase().includes(term) ||
        inv.supplier?.cnpj?.includes(term)
      )
    }
    return true
  })

  // ---- Fetch Client Invoices (Notas Emitidas) ----
  const fetchClientInvoices = useCallback(async () => {
    if (!officeId) return
    setClientInvoicesLoading(true)
    try {
      const res = await apiFetch(`/api/client-invoices?officeId=${officeId}`)
      if (res.success) {
        setClientInvoices(res.data || [])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro ao carregar notas emitidas' }])
    } finally {
      setClientInvoicesLoading(false)
    }
  }, [officeId])

  const handleViewClientInvoice = async (invoiceId: string) => {
    if (!officeId) return
    try {
      const res = await apiFetch(`/api/client-invoices/${invoiceId}?officeId=${officeId}`)
      if (res.success && res.data) {
        setSelectedClientInvoice(res.data as ClientInvoiceData)
        setShowClientInvoiceDoc(true)
      } else {
        setAlerts(prev => [...prev, { type: 'error', message: res.error || 'Erro ao carregar nota fiscal' }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro de conexão' }])
    }
  }

  const handleCancelClientInvoice = async () => {
    if (!cancelInvoiceId || !officeId) return
    setCancelLoading(true)
    try {
      const res = await apiFetch(`/api/client-invoices/${cancelInvoiceId}/cancel`, {
        method: 'POST',
        body: JSON.stringify({
          officeId,
          motivoCancelamento: cancelMotivo || 'Cancelamento sem motivo informado',
        }),
      })
      if (res.success) {
        setAlerts(prev => [...prev, { type: 'info', message: 'Nota fiscal cancelada com sucesso!' }])
        fetchClientInvoices()
        setCancelDialogOpen(false)
        setCancelMotivo('')
        setCancelInvoiceId(null)
      } else {
        setAlerts(prev => [...prev, { type: 'error', message: res.error || 'Erro ao cancelar nota fiscal' }])
      }
    } catch {
      setAlerts(prev => [...prev, { type: 'error', message: 'Erro de conexão' }])
    } finally {
      setCancelLoading(false)
    }
  }

  const openCancelDialog = (invoiceId: string) => {
    setCancelInvoiceId(invoiceId)
    setCancelMotivo('')
    setCancelDialogOpen(true)
  }

  // ==================== RENDER ====================
  return (
    <div className="space-y-6">
      {/* Floating Alerts */}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
        {alerts.map((alert, i) => (
          <Alert key={i} variant={alert.type === 'error' ? 'destructive' : 'default'} className={
            alert.type === 'warning' ? 'border-orange-300 bg-orange-50 text-orange-800' :
            alert.type === 'info' ? 'border-emerald-300 bg-emerald-50 text-emerald-800' :
            undefined
          }>
            {alert.type === 'error' && <XCircle className="h-4 w-4" />}
            {alert.type === 'warning' && <AlertTriangle className="h-4 w-4" />}
            {alert.type === 'info' && <CheckCircle2 className="h-4 w-4" />}
            <AlertDescription className="text-sm">{alert.message}</AlertDescription>
          </Alert>
        ))}
      </div>

      {/* Fiscal KPI Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-blue-500 bg-gradient-to-br from-white to-blue-50/30 shadow-sm overflow-hidden">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="min-w-0 flex-1 mr-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider truncate">Notas de Entrada</p>
              <h3 className="text-2xl font-bold text-zinc-900 mt-1">{invoices.length}</h3>
              <p className="text-xs text-blue-600 font-medium mt-0.5 truncate">
                {formatCurrency(invoices.reduce((s, i) => s + Number(i.totalNf || 0), 0))}
              </p>
            </div>
            <div className="p-3 bg-blue-100/80 rounded-xl text-blue-600 shrink-0">
              <ArrowDownLeft className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-emerald-500 bg-gradient-to-br from-white to-emerald-50/30 shadow-sm overflow-hidden">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="min-w-0 flex-1 mr-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider truncate">Notas Emitidas (Saída)</p>
              <h3 className="text-2xl font-bold text-zinc-900 mt-1">{clientInvoices.length}</h3>
              <p className="text-xs text-emerald-600 font-medium mt-0.5 truncate">
                {formatCurrency(clientInvoices.reduce((s, i) => s + Number(i.totalAmount || 0), 0))}
              </p>
            </div>
            <div className="p-3 bg-emerald-100/80 rounded-xl text-emerald-600 shrink-0">
              <ArrowUpRight className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500 bg-gradient-to-br from-white to-amber-50/30 shadow-sm overflow-hidden">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="min-w-0 flex-1 mr-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider truncate">Impostos Escriturados</p>
              <h3 className="text-2xl font-bold text-zinc-900 mt-1 truncate">
                {formatCurrency(
                  invoices.reduce((s, i) => s + Number(i.valorIcms || 0) + Number(i.valorIpi || 0) + Number(i.valorPis || 0) + Number(i.valorCofins || 0), 0) +
                  clientInvoices.reduce((s, i) => s + Number(i.valorIcms || 0) + Number(i.valorIpi || 0) + Number(i.valorPis || 0) + Number(i.valorCofins || 0), 0)
                )}
              </h3>
              <p className="text-xs text-amber-700 font-medium mt-0.5 truncate">ICMS / IPI / PIS / COFINS</p>
            </div>
            <div className="p-3 bg-amber-100/80 rounded-xl text-amber-700 shrink-0">
              <Percent className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500 bg-gradient-to-br from-white to-purple-50/30 shadow-sm overflow-hidden">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="min-w-0 flex-1 mr-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider truncate">Pendências / Estoque</p>
              <h3 className="text-2xl font-bold text-zinc-900 mt-1">{invoices.filter(i => i.status === 'IMPORTADA' || i.status === 'DIVERGENTE').length}</h3>
              <p className="text-xs text-purple-600 font-medium mt-0.5 truncate">Aguardando Conferência</p>
            </div>
            <div className="p-3 bg-purple-100/80 rounded-xl text-purple-600 shrink-0">
              <ClipboardCheck className="w-6 h-6" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => {
        setActiveTab(v);
        if (v === 'emitidas') fetchClientInvoices();
        if (v === 'regras-fiscais') fetchTaxRules();
      }}>
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-5 h-auto p-1 bg-zinc-100">
          <TabsTrigger value="importar" className="gap-2 py-2.5">
            <Upload className="w-4 h-4" /> Importar / Entrada
          </TabsTrigger>
          <TabsTrigger value="emitidas" className="gap-2 py-2.5">
            <Send className="w-4 h-4" /> Notas Emitidas
          </TabsTrigger>
          <TabsTrigger value="sefaz" className="gap-2 py-2.5">
            <Globe className="w-4 h-4" /> SEFAZ / Certificado
          </TabsTrigger>
          <TabsTrigger value="regras-fiscais" className="gap-2 py-2.5">
            <ShieldCheck className="w-4 h-4" /> Regras Fiscais
          </TabsTrigger>
          <TabsTrigger value="simulador" className="gap-2 py-2.5">
            <Calculator className="w-4 h-4" /> Simulador Fiscal
          </TabsTrigger>
        </TabsList>

        {/* ===== TAB: Importar NF-e ===== */}
        <TabsContent value="importar" className="space-y-6 mt-6">
      {/* Import Area Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Upload className="w-5 h-5 text-emerald-600" />
            Importar NF-e
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* XML Upload Area */}
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                dragOver ? 'border-emerald-500 bg-emerald-50' : 'border-zinc-300 hover:border-emerald-400 hover:bg-zinc-50'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xml"
                className="hidden"
                onChange={handleFileSelect}
              />
              {importing ? (
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
                  <p className="text-sm text-zinc-600">Importando XML...</p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <FileText className="w-8 h-8 text-zinc-400" />
                  <p className="text-sm font-medium text-zinc-700">
                    Arraste um arquivo XML ou clique para selecionar
                  </p>
                  <p className="text-xs text-zinc-500">Apenas arquivos .xml de NF-e</p>
                </div>
              )}
            </div>

            {/* Chave Input + Validate */}
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="chave">Chave NF-e</Label>
                <Input
                  id="chave"
                  placeholder="44 dígitos da chave de acesso"
                  value={chaveInput}
                  onChange={(e) => setChaveInput(maskChave(e.target.value))}
                  maxLength={44}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-zinc-500">
                  {chaveInput.length}/44 dígitos
                  {chaveInput.length === 44 && <span className="text-emerald-600 ml-1">✓ Completa</span>}
                </p>
              </div>

              {/* Import Result */}
              {importResult && (
                <div className={`flex items-start gap-2 p-3 rounded-lg text-sm ${
                  importResult.success
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}>
                  {importResult.success ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-medium">{importResult.message}</p>
                    {importResult.warnings?.map((w, i) => (
                      <p key={i} className="text-xs mt-1 opacity-80">{w}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section 2: Invoices List */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="w-5 h-5 text-emerald-600" />
              Notas Fiscais
            </CardTitle>
            <Button onClick={() => { resetManualForm(); setManualOpen(true) }} className="bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-1" />
              Nova NF Manual
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <Input
                placeholder="Buscar por chave, número ou fornecedor..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-48">
                <SelectValue placeholder="Filtrar status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">Todos os Status</SelectItem>
                <SelectItem value="IMPORTADA">Importada</SelectItem>
                <SelectItem value="CONFERIDA">Conferida</SelectItem>
                <SelectItem value="DIVERGENTE">Divergente</SelectItem>
                <SelectItem value="ESTOQUE_ATUALIZADO">Estoque Atualizado</SelectItem>
                <SelectItem value="PAGA">Paga</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Chave</TableHead>
                  <TableHead>Número</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Data Emissão</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-zinc-500">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2" />
                      Carregando notas fiscais...
                    </TableCell>
                  </TableRow>
                ) : filteredInvoices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-zinc-500">
                      Nenhuma nota fiscal encontrada
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredInvoices.map((inv) => {
                    const statusConf = STATUS_CONFIG[inv.status] || STATUS_CONFIG.IMPORTADA
                    return (
                      <TableRow key={inv.id} className="cursor-pointer hover:bg-zinc-50" onClick={() => openDetail(inv)}>
                        <TableCell className="font-mono text-xs max-w-[120px] truncate" title={inv.chave}>
                          {inv.chave.length > 44 ? inv.chave.substring(0, 20) + '...' : inv.chave.substring(0, 20) + '...'}
                        </TableCell>
                        <TableCell className="font-medium">{inv.numero}</TableCell>
                        <TableCell className="max-w-[150px] truncate">
                          {inv.supplier?.razaoSocial || '—'}
                        </TableCell>
                        <TableCell>{formatDate(inv.dataEmissao)}</TableCell>
                        <TableCell className="font-medium">{formatCurrency(inv.totalNf)}</TableCell>
                        <TableCell>
                          <Badge variant={statusConf.variant} className={statusConf.className}>
                            {statusConf.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <Button size="sm" variant="ghost" onClick={() => openDetail(inv)} title="Ver detalhes">
                              <Eye className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openPricingModal(inv)} className="text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800" title="Precificar Venda e Margem de Lucro">
                              <DollarSign className="w-4 h-4" />
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => handleValidate(inv.id)} disabled={validating} title="Validar XML">
                              {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

        </TabsContent>

        {/* ===== TAB: SEFAZ ===== */}
        <TabsContent value="sefaz" className="space-y-6 mt-6">
          <SefazModule />
        </TabsContent>

        {/* ===== TAB: Notas Emitidas ===== */}
        <TabsContent value="emitidas" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Send className="w-5 h-5 text-amber-600" />
                  Notas Fiscais Emitidas
                </CardTitle>
                <Button variant="outline" size="sm" onClick={fetchClientInvoices} className="gap-1">
                  <RefreshCw className="w-3.5 h-3.5" /> Atualizar
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {clientInvoicesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
                  <span className="ml-2 text-zinc-500">Carregando notas emitidas...</span>
                </div>
              ) : clientInvoices.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Send className="w-12 h-12 text-zinc-300 mb-3" />
                  <p className="text-zinc-500">Nenhuma nota fiscal emitida</p>
                  <p className="text-sm text-zinc-400">Emita notas fiscais a partir de vendas ou ordens de serviço</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Número</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Data Emissão</TableHead>
                        <TableHead className="text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {clientInvoices.map((inv) => {
                        const status = inv.status
                        const type = inv.type
                        const isCancelled = status === 'CANCELADA'
                        return (
                          <TableRow key={inv.id} className={`cursor-pointer hover:bg-zinc-50 ${isCancelled ? 'opacity-60' : ''}`}>
                            <TableCell className="font-medium">{inv.number}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={type === 'VENDA' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200'}>
                                {type === 'VENDA' ? 'Venda' : 'Serviço'}
                              </Badge>
                            </TableCell>
                            <TableCell>{inv.destNome || '—'}</TableCell>
                            <TableCell className="font-medium">{formatCurrency(inv.totalAmount)}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={isCancelled ? 'bg-red-50 text-red-700 border-red-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}>
                                {isCancelled ? 'Cancelada' : 'Emitida'}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-zinc-500">{formatDate(inv.dataEmissao)}</TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button size="sm" variant="ghost" onClick={() => handleViewClientInvoice(inv.id)} title="Ver nota fiscal">
                                  <Eye className="w-4 h-4" />
                                </Button>
                                {!isCancelled && (
                                  <Button size="sm" variant="ghost" onClick={() => openCancelDialog(inv.id)} className="text-red-500 hover:text-red-700" title="Cancelar nota fiscal">
                                    <Ban className="w-4 h-4" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB: Regras Fiscais ===== */}
        <TabsContent value="regras-fiscais" className="space-y-6 mt-6">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <ShieldCheck className="w-5 h-5 text-emerald-600" />
                  Regras Tributárias & Alíquotas por Estado / NCM
                </CardTitle>
                <p className="text-xs text-zinc-500 mt-1">
                  Gerencie as regras de cálculo de tributos (ICMS, IPI, PIS, COFINS) associadas à combinação NCM + CFOP + UF.
                </p>
              </div>
              <Button
                onClick={() => setNewTaxRuleOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1"
              >
                <Plus className="w-4 h-4" /> Nova Regra Fiscal
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
                  <Input
                    placeholder="Buscar por NCM, CFOP ou UF..."
                    value={taxRuleSearch}
                    onChange={(e) => setTaxRuleSearch(e.target.value)}
                    className="pl-9 text-sm"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={fetchTaxRules} disabled={taxRulesLoading}>
                  <RefreshCw className={`w-4 h-4 ${taxRulesLoading ? 'animate-spin' : ''}`} />
                </Button>
              </div>

              {taxRulesLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
                </div>
              ) : taxRules.length === 0 ? (
                <div className="text-center py-12 text-zinc-500 text-sm">
                  Nenhuma regra fiscal cadastrada. Clique em "Nova Regra Fiscal" para adicionar.
                </div>
              ) : (
                <div className="border rounded-md overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-zinc-50">
                        <TableHead>NCM</TableHead>
                        <TableHead>CFOP</TableHead>
                        <TableHead>UF</TableHead>
                        <TableHead>CST / CSOSN</TableHead>
                        <TableHead className="text-right">ICMS (%)</TableHead>
                        <TableHead className="text-right">IPI (%)</TableHead>
                        <TableHead className="text-right">PIS (%)</TableHead>
                        <TableHead className="text-right">COFINS (%)</TableHead>
                        <TableHead className="text-center">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {taxRules
                        .filter(rule => {
                          if (!taxRuleSearch.trim()) return true
                          const q = taxRuleSearch.toLowerCase()
                          return rule.ncm.toLowerCase().includes(q) || rule.cfop.toLowerCase().includes(q) || rule.state.toLowerCase().includes(q)
                        })
                        .map((rule) => (
                          <TableRow key={rule.id} className="hover:bg-zinc-50">
                            <TableCell className="font-mono text-xs font-bold text-zinc-900">{rule.ncm}</TableCell>
                            <TableCell className="font-mono text-xs text-zinc-700">{rule.cfop}</TableCell>
                            <TableCell className="font-bold text-xs text-zinc-800">{rule.state}</TableCell>
                            <TableCell className="text-xs text-zinc-600">
                              {rule.cst ? `CST ${rule.cst}` : rule.csosn ? `CSOSN ${rule.csosn}` : '—'}
                            </TableCell>
                            <TableCell className="text-right font-medium text-xs text-blue-700">{rule.aliqIcms}%</TableCell>
                            <TableCell className="text-right font-medium text-xs text-purple-700">{rule.aliqIpi}%</TableCell>
                            <TableCell className="text-right font-medium text-xs text-amber-700">{rule.aliqPis}%</TableCell>
                            <TableCell className="text-right font-medium text-xs text-emerald-700">{rule.aliqCofins}%</TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className={rule.active ? 'bg-emerald-50 text-emerald-700 border-emerald-300' : 'bg-zinc-100 text-zinc-600'}>
                                {rule.active ? 'Ativa' : 'Inativa'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ===== TAB: Simulador Fiscal ===== */}
        <TabsContent value="simulador" className="space-y-6 mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Calculator className="w-5 h-5 text-emerald-600" />
                Simulador & Calculadora Tributária Interativa
              </CardTitle>
              <p className="text-xs text-zinc-500">
                Simule a carga tributária incidente sobre operações de Venda de Produtos ou Serviços de Oficina antes de emitir a Nota Fiscal.
              </p>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Inputs Column */}
                <div className="space-y-4 bg-zinc-50 p-4 rounded-xl border border-zinc-200">
                  <h4 className="font-bold text-sm text-zinc-900 flex items-center gap-1.5">
                    <Layers className="w-4 h-4 text-emerald-600" /> Parâmetros da Operação
                  </h4>

                  <div className="space-y-1">
                    <Label className="text-xs">Tipo de Operação</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={simType === 'PRODUTO' ? 'default' : 'outline'}
                        className={simType === 'PRODUTO' ? 'bg-emerald-600 text-white' : ''}
                        onClick={() => setSimType('PRODUTO')}
                      >
                        Venda de Peças (NF-e)
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={simType === 'SERVICO' ? 'default' : 'outline'}
                        className={simType === 'SERVICO' ? 'bg-emerald-600 text-white' : ''}
                        onClick={() => setSimType('SERVICO')}
                      >
                        Serviço (NFS-e)
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Valor Bruto da Operação (R$) *</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={simValor}
                      onChange={(e) => setSimValor(parseFloat(e.target.value) || 0)}
                      className="text-base font-bold text-emerald-800 bg-white"
                    />
                  </div>

                  {simType === 'PRODUTO' ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">ICMS (%)</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={simAliqIcms}
                            onChange={(e) => setSimAliqIcms(parseFloat(e.target.value) || 0)}
                            className="text-xs bg-white"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">IPI (%)</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={simAliqIpi}
                            onChange={(e) => setSimAliqIpi(parseFloat(e.target.value) || 0)}
                            className="text-xs bg-white"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">PIS (%)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={simAliqPis}
                            onChange={(e) => setSimAliqPis(parseFloat(e.target.value) || 0)}
                            className="text-xs bg-white"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">COFINS (%)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={simAliqCofins}
                            onChange={(e) => setSimAliqCofins(parseFloat(e.target.value) || 0)}
                            className="text-xs bg-white"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">ISSQN Municipal (%)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={simAliqIssqn}
                          onChange={(e) => setSimAliqIssqn(parseFloat(e.target.value) || 0)}
                          className="text-xs bg-white"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">PIS (%)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={simAliqPis}
                            onChange={(e) => setSimAliqPis(parseFloat(e.target.value) || 0)}
                            className="text-xs bg-white"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">COFINS (%)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={simAliqCofins}
                            onChange={(e) => setSimAliqCofins(parseFloat(e.target.value) || 0)}
                            className="text-xs bg-white"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* Calculation Results Column */}
                <div className="lg:col-span-2 space-y-4">
                  {(() => {
                    const icmsVal = simType === 'PRODUTO' ? simValor * (simAliqIcms / 100) : 0
                    const ipiVal = simType === 'PRODUTO' ? simValor * (simAliqIpi / 100) : 0
                    const pisVal = simValor * (simAliqPis / 100)
                    const cofinsVal = simValor * (simAliqCofins / 100)
                    const issqnVal = simType === 'SERVICO' ? simValor * (simAliqIssqn / 100) : 0
                    const totalImpostosSim = icmsVal + ipiVal + pisVal + cofinsVal + issqnVal
                    const liquidaVal = simValor - totalImpostosSim
                    const cargaEfetivaPct = simValor > 0 ? (totalImpostosSim / simValor) * 100 : 0

                    return (
                      <>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                          <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl">
                            <p className="text-xs font-semibold text-emerald-800 uppercase">Valor Bruto Operação</p>
                            <h3 className="text-2xl font-bold text-emerald-900 mt-1">{formatCurrency(simValor)}</h3>
                          </div>
                          <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl">
                            <p className="text-xs font-semibold text-amber-800 uppercase">Total Tributos (R$)</p>
                            <h3 className="text-2xl font-bold text-amber-900 mt-1">{formatCurrency(totalImpostosSim)}</h3>
                            <p className="text-xs text-amber-700 font-semibold mt-0.5">{cargaEfetivaPct.toFixed(2)}% da operação</p>
                          </div>
                          <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl">
                            <p className="text-xs font-semibold text-blue-800 uppercase">Valor Líquido pós Impostos</p>
                            <h3 className="text-2xl font-bold text-blue-900 mt-1">{formatCurrency(liquidaVal)}</h3>
                          </div>
                        </div>

                        {/* Detailed Tax Breakdown */}
                        <div className="border rounded-xl p-4 space-y-3 bg-white">
                          <h4 className="font-bold text-sm text-zinc-900">Detalhamento dos Tributos Incidentes</h4>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            {simType === 'PRODUTO' ? (
                              <>
                                <div className="p-3 bg-zinc-50 rounded-lg border">
                                  <span className="text-zinc-500 block">ICMS ({simAliqIcms}%)</span>
                                  <span className="text-sm font-bold text-blue-700 mt-0.5 block">{formatCurrency(icmsVal)}</span>
                                </div>
                                <div className="p-3 bg-zinc-50 rounded-lg border">
                                  <span className="text-zinc-500 block">IPI ({simAliqIpi}%)</span>
                                  <span className="text-sm font-bold text-purple-700 mt-0.5 block">{formatCurrency(ipiVal)}</span>
                                </div>
                              </>
                            ) : (
                              <div className="p-3 bg-zinc-50 rounded-lg border">
                                <span className="text-zinc-500 block">ISSQN Municipal ({simAliqIssqn}%)</span>
                                <span className="text-sm font-bold text-emerald-700 mt-0.5 block">{formatCurrency(issqnVal)}</span>
                              </div>
                            )}
                            <div className="p-3 bg-zinc-50 rounded-lg border">
                              <span className="text-zinc-500 block">PIS ({simAliqPis}%)</span>
                              <span className="text-sm font-bold text-amber-700 mt-0.5 block">{formatCurrency(pisVal)}</span>
                            </div>
                            <div className="p-3 bg-zinc-50 rounded-lg border">
                              <span className="text-zinc-500 block">COFINS ({simAliqCofins}%)</span>
                              <span className="text-sm font-bold text-emerald-700 mt-0.5 block">{formatCurrency(cofinsVal)}</span>
                            </div>
                          </div>
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* New Tax Rule Dialog */}
      <Dialog open={newTaxRuleOpen} onOpenChange={setNewTaxRuleOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-emerald-600" />
              Nova Regra Fiscal
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">NCM (8 dígitos) *</Label>
                <Input
                  value={newTaxRuleForm.ncm}
                  onChange={(e) => setNewTaxRuleForm(prev => ({ ...prev, ncm: e.target.value.replace(/\D/g, '').slice(0, 8) }))}
                  placeholder="Ex: 87082999"
                  className="h-9 text-sm font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CFOP (4 dígitos) *</Label>
                <Input
                  value={newTaxRuleForm.cfop}
                  onChange={(e) => setNewTaxRuleForm(prev => ({ ...prev, cfop: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                  placeholder="Ex: 5102"
                  className="h-9 text-sm font-mono"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Estado / UF *</Label>
                <Input
                  value={newTaxRuleForm.state}
                  onChange={(e) => setNewTaxRuleForm(prev => ({ ...prev, state: e.target.value.toUpperCase().slice(0, 2) }))}
                  placeholder="BA"
                  className="h-9 text-sm uppercase"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CSOSN / CST</Label>
                <Input
                  value={newTaxRuleForm.csosn}
                  onChange={(e) => setNewTaxRuleForm(prev => ({ ...prev, csosn: e.target.value }))}
                  placeholder="102"
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Alíquota ICMS (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={newTaxRuleForm.aliqIcms}
                  onChange={(e) => setNewTaxRuleForm(prev => ({ ...prev, aliqIcms: parseFloat(e.target.value) || 0 }))}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Alíquota IPI (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={newTaxRuleForm.aliqIpi}
                  onChange={(e) => setNewTaxRuleForm(prev => ({ ...prev, aliqIpi: parseFloat(e.target.value) || 0 }))}
                  className="h-9 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Alíquota PIS (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newTaxRuleForm.aliqPis}
                  onChange={(e) => setNewTaxRuleForm(prev => ({ ...prev, aliqPis: parseFloat(e.target.value) || 0 }))}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Alíquota COFINS (%)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newTaxRuleForm.aliqCofins}
                  onChange={(e) => setNewTaxRuleForm(prev => ({ ...prev, aliqCofins: parseFloat(e.target.value) || 0 }))}
                  className="h-9 text-sm"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setNewTaxRuleOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleCreateTaxRule}
              disabled={newTaxRuleSaving || !newTaxRuleForm.ncm || !newTaxRuleForm.cfop}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
            >
              {newTaxRuleSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Salvar Regra Fiscal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Section 3: Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-emerald-600" />
              Detalhes da NF-e
              {selectedInvoice && (
                <Badge variant="secondary" className={STATUS_CONFIG[selectedInvoice.status]?.className || ''}>
                  {STATUS_CONFIG[selectedInvoice.status]?.label || selectedInvoice.status}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {detailLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
            </div>
          ) : selectedInvoice ? (
            <div className="space-y-6">
              {/* Alerts for this NF */}
              {validationData && !validationData.valid && (
                <Alert variant="destructive">
                  <XCircle className="h-4 w-4" />
                  <AlertDescription>
                    <p className="font-medium">NF-e com erros de validação ({validationData.summary.totalErrors} erros, {validationData.summary.totalWarnings} avisos)</p>
                  </AlertDescription>
                </Alert>
              )}
              {validationData && validationData.valid && (
                <Alert className="border-emerald-300 bg-emerald-50 text-emerald-800">
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>NF-e válida! Todos os totais conferem.</AlertDescription>
                </Alert>
              )}
              {selectedInvoice.items.some(i => !i.sku) && (
                <Alert className="border-yellow-300 bg-yellow-50 text-yellow-800">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    {selectedInvoice.items.filter(i => !i.sku).length} item(ns) sem SKU — não será possível mapear para o estoque automaticamente.
                  </AlertDescription>
                </Alert>
              )}
              {selectedInvoice.status === 'DIVERGENTE' && (
                <Alert className="border-orange-300 bg-orange-50 text-orange-800">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Divergência detectada! {selectedInvoice.reception?.divergencia || 'Verifique os itens divergentes.'}
                  </AlertDescription>
                </Alert>
              )}

              {/* Cabeçalho */}
              <Tabs defaultValue="cabecalho">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="cabecalho">Cabeçalho</TabsTrigger>
                  <TabsTrigger value="itens">Itens ({selectedInvoice.items.length})</TabsTrigger>
                  <TabsTrigger value="financeiro">Financeiro</TabsTrigger>
                </TabsList>

                <TabsContent value="cabecalho" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                    <div>
                      <p className="text-xs text-zinc-500">CNPJ Fornecedor</p>
                      <p className="font-medium">{selectedInvoice.supplier?.cnpj ? formatCnpj(selectedInvoice.supplier.cnpj) : '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Razão Social</p>
                      <p className="font-medium">{selectedInvoice.supplier?.razaoSocial || '—'}</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Número NF</p>
                      <p className="font-medium">{selectedInvoice.numero}</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Série</p>
                      <p className="font-medium">{selectedInvoice.serie}</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Data Emissão</p>
                      <p className="font-medium">{formatDate(selectedInvoice.dataEmissao)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-zinc-500">Tipo Operação</p>
                      <p className="font-medium">{selectedInvoice.tipoOperacao === 'ENTRADA' ? 'Entrada' : 'Retorno'}</p>
                    </div>
                    <div className="col-span-2 md:col-span-3">
                      <p className="text-xs text-zinc-500">Chave de Acesso</p>
                      <p className="font-mono text-sm font-medium break-all">{selectedInvoice.chave}</p>
                    </div>
                    {selectedInvoice.observacao && (
                      <div className="col-span-2 md:col-span-3">
                        <p className="text-xs text-zinc-500">Observação</p>
                        <p className="text-sm">{selectedInvoice.observacao}</p>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="itens" className="mt-4">
                  <div className="space-y-3">
                    {/* Header with save button */}
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-zinc-600">
                        Vincule cada item da NF-e a um produto do estoque. Busque por <strong>SKU</strong> ou <strong>descrição</strong>.
                      </p>
                      <Button
                        size="sm"
                        onClick={handleSaveMappings}
                        disabled={Object.values(itemPartMap).filter(Boolean).length === 0}
                        className="bg-emerald-600 hover:bg-emerald-700 gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Salvar Mapeamentos ({Object.values(itemPartMap).filter(Boolean).length}/{selectedInvoice.items.length})
                      </Button>
                    </div>

                    {/* Items with mapping UI */}
                    {selectedInvoice.items.map((item) => {
                      const mappedPartId = itemPartMap[item.id]
                      const isMapped = !!mappedPartId

                      return (
                        <Card key={item.id} className={`border ${item.divergencia ? 'border-orange-300 bg-orange-50/30' : isMapped ? 'border-emerald-200 bg-emerald-50/30' : 'border-zinc-200'}`}>
                          <CardContent className="p-3">
                            <div className="flex items-start gap-4">
                              {/* Left: Item info */}
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  {item.sku ? (
                                    <Badge variant="outline" className="font-mono text-xs">{item.sku}</Badge>
                                  ) : (
                                    <Badge variant="outline" className="bg-orange-100 text-orange-700 text-xs border-orange-300">Sem SKU</Badge>
                                  )}
                                  <span className="text-xs text-zinc-500">NCM: {item.ncm}</span>
                                  <span className="text-xs text-zinc-400">CFOP: {item.cfop}</span>
                                </div>
                                <p className="font-medium text-zinc-900 text-sm truncate" title={item.descricao}>
                                  {item.descricao}
                                </p>
                                <div className="flex items-center gap-3 mt-1 text-xs text-zinc-500">
                                  <span>Qtd: <strong className="text-zinc-700">{item.quantidade}</strong> {item.unidade}</span>
                                  <span>Unit: <strong className="text-zinc-700">{formatCurrency(item.valorUnitario)}</strong></span>
                                  <span>Total: <strong className="text-zinc-900">{formatCurrency(item.valorTotal)}</strong></span>
                                </div>
                              </div>

                              {/* Right: Mapping UI */}
                              <div className="w-72 shrink-0">
                                {isMapped ? (
                                  <div className="flex items-center gap-2 p-2 bg-emerald-50 rounded-lg border border-emerald-200">
                                    <Package className="w-4 h-4 text-emerald-600 shrink-0" />
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium text-emerald-800 truncate">
                                        Vinculado ao estoque
                                      </p>
                                      <p className="text-xs text-emerald-600 truncate">
                                        ID: {mappedPartId.substring(0, 12)}...
                                      </p>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 text-zinc-400 hover:text-red-500 shrink-0"
                                      onClick={() => unmapItemPart(item.id)}
                                      title="Desvincular"
                                    >
                                      <XCircle className="w-3.5 h-3.5" />
                                    </Button>
                                  </div>
                                ) : (
                                  <div className="space-y-2">
                                    <div className="relative">
                                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-400" />
                                      <Input
                                        placeholder="Buscar por SKU ou descrição..."
                                        value={partSearchTerm[item.id] || ''}
                                        onChange={(e) => handlePartSearch(item.id, e.target.value)}
                                        className="h-8 text-xs pl-8"
                                      />
                                      {partSearchLoading[item.id] && (
                                        <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-zinc-400" />
                                      )}
                                    </div>

                                    {/* Search results dropdown */}
                                    {partSearchResults[item.id] && partSearchResults[item.id].length > 0 && (
                                      <div className="bg-white border border-zinc-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                                        {partSearchResults[item.id].map((part) => (
                                          <button
                                            key={part.id}
                                            onClick={() => selectPartForItem(item.id, part.id)}
                                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-emerald-50 text-left transition-colors border-b border-zinc-100 last:border-0"
                                          >
                                            <Package className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                              <p className="text-xs font-medium text-zinc-900 truncate">{part.description}</p>
                                              <p className="text-xs text-zinc-500">SKU: {part.sku} · Estoque: {part.quantity} · R$ {part.salePrice?.toFixed(2)}</p>
                                            </div>
                                            <Plus className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                                          </button>
                                        ))}
                                      </div>
                                    )}

                                    {/* No results found */}
                                    {partSearchTerm[item.id] && partSearchTerm[item.id].length >= 2 && partSearchResults[item.id] && partSearchResults[item.id].length === 0 && !partSearchLoading[item.id] && (
                                      <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg">
                                        <p className="text-xs text-amber-700 mb-1">Nenhum item encontrado no estoque.</p>
                                        <Button
                                          size="sm"
                                          variant="outline"
                                          className="h-6 text-xs gap-1 border-amber-300 text-amber-700 hover:bg-amber-100"
                                          onClick={() => openNewPartDialog(item.id)}
                                        >
                                          <Plus className="w-3 h-3" />
                                          Cadastrar no Estoque
                                        </Button>
                                      </div>
                                    )}

                                    {/* Quick link to create new */}
                                    {!partSearchTerm[item.id] && (
                                      <button
                                        onClick={() => openNewPartDialog(item.id)}
                                        className="w-full flex items-center justify-center gap-1 py-1.5 text-xs text-zinc-500 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg border border-dashed border-zinc-300 hover:border-emerald-300 transition-colors"
                                      >
                                        <Plus className="w-3 h-3" />
                                        Cadastrar novo item no estoque
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                </TabsContent>

                <TabsContent value="financeiro" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                    <div className="p-3 bg-zinc-50 rounded-lg">
                      <p className="text-xs text-zinc-500">Subtotal</p>
                      <p className="text-lg font-semibold">{formatCurrency(selectedInvoice.subtotal)}</p>
                    </div>
                    <div className="p-3 bg-zinc-50 rounded-lg">
                      <p className="text-xs text-zinc-500">Frete</p>
                      <p className="text-lg font-semibold">{formatCurrency(selectedInvoice.frete)}</p>
                    </div>
                    <div className="p-3 bg-zinc-50 rounded-lg">
                      <p className="text-xs text-zinc-500">Seguro</p>
                      <p className="text-lg font-semibold">{formatCurrency(selectedInvoice.seguro)}</p>
                    </div>
                    <div className="p-3 bg-zinc-50 rounded-lg">
                      <p className="text-xs text-zinc-500">Descontos</p>
                      <p className="text-lg font-semibold text-red-600">-{formatCurrency(selectedInvoice.desconto)}</p>
                    </div>
                    <div className="p-3 bg-zinc-50 rounded-lg">
                      <p className="text-xs text-zinc-500">Base ICMS</p>
                      <p className="text-lg font-semibold">{formatCurrency(selectedInvoice.baseIcms)}</p>
                    </div>
                    <div className="p-3 bg-zinc-50 rounded-lg">
                      <p className="text-xs text-zinc-500">ICMS</p>
                      <p className="text-lg font-semibold">{formatCurrency(selectedInvoice.valorIcms)}</p>
                    </div>
                    <div className="p-3 bg-zinc-50 rounded-lg">
                      <p className="text-xs text-zinc-500">IPI</p>
                      <p className="text-lg font-semibold">{formatCurrency(selectedInvoice.valorIpi)}</p>
                    </div>
                    <div className="p-3 bg-zinc-50 rounded-lg">
                      <p className="text-xs text-zinc-500">PIS</p>
                      <p className="text-lg font-semibold">{formatCurrency(selectedInvoice.valorPis)}</p>
                    </div>
                    <div className="p-3 bg-zinc-50 rounded-lg">
                      <p className="text-xs text-zinc-500">COFINS</p>
                      <p className="text-lg font-semibold">{formatCurrency(selectedInvoice.valorCofins)}</p>
                    </div>
                  </div>

                  {/* Total */}
                  <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-emerald-800">Total NF-e</p>
                      <p className="text-2xl font-bold text-emerald-700">{formatCurrency(selectedInvoice.totalNf)}</p>
                    </div>
                    {/* Validation check */}
                    {(() => {
                      const expected = selectedInvoice.subtotal + selectedInvoice.frete + selectedInvoice.seguro - selectedInvoice.desconto + selectedInvoice.valorIpi
                      const diff = Math.abs(expected - selectedInvoice.totalNf)
                      if (diff > 0.02) {
                        return (
                          <div className="flex items-center gap-1 mt-2 text-orange-700 text-xs">
                            <AlertTriangle className="w-3 h-3" />
                            Divergência: esperado {formatCurrency(expected)}, informado {formatCurrency(selectedInvoice.totalNf)}
                          </div>
                        )
                      }
                      return (
                        <div className="flex items-center gap-1 mt-2 text-emerald-700 text-xs">
                          <CheckCircle2 className="w-3 h-3" />
                          Totais conferem
                        </div>
                      )
                    })()}
                  </div>
                </TabsContent>
              </Tabs>

              {/* Section 4: Actions */}
              <div className="flex flex-wrap gap-2 pt-4 border-t">
                <Button
                  variant="outline"
                  onClick={() => openConference(selectedInvoice)}
                  disabled={selectedInvoice.status === 'CONFERIDA' || selectedInvoice.status === 'ESTOQUE_ATUALIZADO' || selectedInvoice.status === 'PAGA'}
                >
                  <ClipboardCheck className="w-4 h-4 mr-1" />
                  Conferir Recebimento
                </Button>
                <Button
                  variant="outline"
                  onClick={handleStockUpdate}
                  disabled={selectedInvoice.status !== 'CONFERIDA' || updatingStock}
                >
                  {updatingStock ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Package className="w-4 h-4 mr-1" />}
                  Atualizar Estoque
                </Button>
                <Button
                  variant="outline"
                  onClick={() => openPricingModal(selectedInvoice)}
                  className="border-emerald-300 text-emerald-800 hover:bg-emerald-50 font-semibold"
                >
                  <DollarSign className="w-4 h-4 mr-1 text-emerald-600" />
                  Precificar Venda / Margens
                </Button>
                <Button
                  variant="outline"
                  onClick={handleGenerateTitulo}
                  disabled={selectedInvoice.status === 'PAGA' || generatingTitulo}
                >
                  {generatingTitulo ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <DollarSign className="w-4 h-4 mr-1" />}
                  Gerar Título a Pagar
                </Button>
                {selectedInvoice.status === 'DIVERGENTE' && (
                  <Button variant="destructive" disabled>
                    <Ban className="w-4 h-4 mr-1" />
                    Bloqueado por Divergência
                  </Button>
                )}
                <Button
                  variant="ghost"
                  onClick={() => handleValidate(selectedInvoice.id)}
                  disabled={validating}
                >
                  {validating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-1" />}
                  Validar XML
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Conference Dialog */}
      <Dialog open={conferenceOpen} onOpenChange={setConferenceOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="w-5 h-5 text-emerald-600" />
              Conferir Recebimento
            </DialogTitle>
          </DialogHeader>
          {selectedInvoice && (
            <div className="space-y-4">
              <p className="text-sm text-zinc-600">
                Informe as quantidades recebidas para cada item da NF-e <strong>{selectedInvoice.numero}</strong>
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Qtd NF</TableHead>
                    <TableHead className="text-right">Qtd Recebida</TableHead>
                    <TableHead>Diferença</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedInvoice.items.map((item) => {
                    const received = conferenceQuantities[item.id] ?? item.quantidade
                    const diff = received - item.quantidade
                    return (
                      <TableRow key={item.id} className={diff !== 0 ? 'bg-orange-50' : ''}>
                        <TableCell className="max-w-[200px] truncate">{item.descricao}</TableCell>
                        <TableCell className="text-right">{item.quantidade}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={received}
                            onChange={(e) => setConferenceQuantities(prev => ({
                              ...prev,
                              [item.id]: parseFloat(e.target.value) || 0
                            }))}
                            className="w-24 ml-auto text-right"
                          />
                        </TableCell>
                        <TableCell>
                          {diff === 0 ? (
                            <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100">OK</Badge>
                          ) : (
                            <Badge className="bg-orange-100 text-orange-800 hover:bg-orange-100">
                              {diff > 0 ? '+' : ''}{diff.toFixed(2)}
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConferenceOpen(false)}>Cancelar</Button>
            <Button onClick={handleConference} disabled={conferencing} className="bg-emerald-600 hover:bg-emerald-700">
              {conferencing ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
              Confirmar Conferência
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Part Dialog - Create part from NF-e item */}
      <Dialog open={newPartDialogOpen} onOpenChange={setNewPartDialogOpen}>
        <DialogContent className="max-w-[95vw] md:max-w-2xl lg:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="w-5 h-5 text-emerald-600" />
              Cadastrar Item no Estoque
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">SKU / Código Interno *</Label>
                <Input
                  value={newPartForm.sku}
                  onChange={(e) => setNewPartForm(prev => ({ ...prev, sku: e.target.value }))}
                  placeholder="Ex: FILTRO-001"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unidade</Label>
                <Select value={newPartForm.unit} onValueChange={(v) => setNewPartForm(prev => ({ ...prev, unit: v }))}>
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UN">UN - Unidade</SelectItem>
                    <SelectItem value="PC">PC - Peça</SelectItem>
                    <SelectItem value="KG">KG - Quilograma</SelectItem>
                    <SelectItem value="LT">LT - Litro</SelectItem>
                    <SelectItem value="MT">MT - Metro</SelectItem>
                    <SelectItem value="CX">CX - Caixa</SelectItem>
                    <SelectItem value="JG">JG - Jogo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Descrição *</Label>
              <Input
                value={newPartForm.description}
                onChange={(e) => setNewPartForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Descrição do produto"
                className="h-9 text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">NCM</Label>
                <Input
                  value={newPartForm.ncm}
                  onChange={(e) => setNewPartForm(prev => ({ ...prev, ncm: e.target.value }))}
                  placeholder="0000.00.00"
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Qtd Mínima</Label>
                <Input
                  type="number"
                  value={newPartForm.minQuantity}
                  onChange={(e) => setNewPartForm(prev => ({ ...prev, minQuantity: parseFloat(e.target.value) || 0 }))}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Preço de Custo (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newPartForm.costPrice}
                  onChange={(e) => {
                    const cost = parseFloat(e.target.value) || 0
                    setNewPartForm(prev => ({ ...prev, costPrice: cost, salePrice: Math.round(cost * 1.4 * 100) / 100 }))
                  }}
                  className="h-9 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Preço de Venda (R$)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={newPartForm.salePrice}
                  onChange={(e) => setNewPartForm(prev => ({ ...prev, salePrice: parseFloat(e.target.value) || 0 }))}
                  className="h-9 text-sm"
                />
              </div>
            </div>
            <div className="p-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
              A quantidade inicial será definida ao atualizar o estoque da NF-e. Este cadastro cria o item com estoque zero.
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setNewPartDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleSaveNewPart}
              disabled={newPartSaving || !newPartForm.sku || !newPartForm.description}
              className="bg-emerald-600 hover:bg-emerald-700 gap-1"
            >
              {newPartSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Cadastrar e Vincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Manual NF Dialog */}
      <Dialog open={manualOpen} onOpenChange={setManualOpen}>
        <DialogContent className="max-w-[95vw] lg:max-w-6xl xl:max-w-7xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-5 h-5 text-emerald-600" />
              Nova NF-e / Recibo de Compra Manual
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-6">
            {/* Header fields */}
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
              <div className="space-y-1">
                <Label>Número NF *</Label>
                <Input value={manualForm.numero} onChange={(e) => setManualForm(p => ({ ...p, numero: e.target.value }))} placeholder="001" />
              </div>
              <div className="space-y-1">
                <Label>Série *</Label>
                <Input value={manualForm.serie} onChange={(e) => setManualForm(p => ({ ...p, serie: e.target.value }))} placeholder="1" />
              </div>
              <div className="space-y-1">
                <Label>Tipo Operação</Label>
                <Select value={manualForm.tipoOperacao} onValueChange={(v) => setManualForm(p => ({ ...p, tipoOperacao: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ENTRADA">Entrada</SelectItem>
                    <SelectItem value="RETORNO">Retorno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Data Emissão *</Label>
                <Input type="date" value={manualForm.dataEmissao} onChange={(e) => setManualForm(p => ({ ...p, dataEmissao: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label>CNPJ Fornecedor *</Label>
                <Input value={manualForm.supplierCnpj} onChange={(e) => setManualForm(p => ({ ...p, supplierCnpj: maskCNPJ(e.target.value) }))} placeholder="00.000.000/0000-00" maxLength={18} />
              </div>
              <div className="space-y-1">
                <Label>Razão Social *</Label>
                <Input value={manualForm.supplierRazaoSocial} onChange={(e) => setManualForm(p => ({ ...p, supplierRazaoSocial: e.target.value }))} placeholder="Nome do fornecedor" />
              </div>
              <div className="space-y-1">
                <Label>Chave NF-e</Label>
                <Input value={manualForm.chave} onChange={(e) => setManualForm(p => ({ ...p, chave: maskChave(e.target.value) }))} placeholder="Opcional - 44 dígitos" maxLength={44} />
              </div>
              <div className="space-y-1">
                <Label>Frete</Label>
                <Input type="number" min={0} step="0.01" value={manualForm.frete} onChange={(e) => setManualForm(p => ({ ...p, frete: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1">
                <Label>Seguro</Label>
                <Input type="number" min={0} step="0.01" value={manualForm.seguro} onChange={(e) => setManualForm(p => ({ ...p, seguro: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1">
                <Label>Desconto</Label>
                <Input type="number" min={0} step="0.01" value={manualForm.desconto} onChange={(e) => setManualForm(p => ({ ...p, desconto: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="col-span-2 md:col-span-2 space-y-1">
                <Label>Observação</Label>
                <Textarea value={manualForm.observacao} onChange={(e) => setManualForm(p => ({ ...p, observacao: e.target.value }))} placeholder="Observações da NF-e" rows={2} />
              </div>
            </div>

            {/* Items grid */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <Label className="text-base font-semibold">Itens da Nota Fiscal / Recibo de Compra</Label>
                  <p className="text-xs text-zinc-500">Selecione produtos cadastrados do estoque para preenchimento automático.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => openProductSearchModal(null)} className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 gap-1">
                    <Search className="w-3.5 h-3.5 text-emerald-600" /> Buscar Produto Cadastrado
                  </Button>
                  <Button size="sm" variant="outline" onClick={addManualItem} className="gap-1">
                    <Plus className="w-3.5 h-3.5" /> Adicionar Linha
                  </Button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Buscar / SKU</TableHead>
                      <TableHead>Descrição *</TableHead>
                      <TableHead>NCM *</TableHead>
                      <TableHead>CFOP *</TableHead>
                      <TableHead className="text-right">Qtd *</TableHead>
                      <TableHead>Und</TableHead>
                      <TableHead className="text-right">V. Unit *</TableHead>
                      <TableHead className="text-right">V. Total</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {manualItems.map((item, index) => (
                      <TableRow key={index}>
                        <TableCell className="align-middle">
                          <div className="flex items-center gap-1">
                            <Input value={item.sku} onChange={(e) => updateManualItem(index, 'sku', e.target.value)} className="min-w-[120px] w-full font-mono text-xs" placeholder="SKU" />
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              title="Buscar produto cadastrado no estoque"
                              onClick={() => openProductSearchModal(index)}
                              className="h-8 w-8 p-0 text-emerald-700 hover:bg-emerald-100 shrink-0"
                            >
                              <Search className="w-4 h-4" />
                            </Button>
                          </div>
                          {item.partId && (
                            <Badge variant="outline" className="mt-1 bg-emerald-50 text-emerald-700 border-emerald-300 text-[10px]">
                              ✓ Vinc. Estoque
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="align-middle min-w-[260px]">
                          <Input value={item.descricao} onChange={(e) => updateManualItem(index, 'descricao', e.target.value)} className="w-full text-xs font-medium" placeholder="Descrição do item" />
                        </TableCell>
                        <TableCell className="align-middle">
                          <Input value={item.ncm} onChange={(e) => updateManualItem(index, 'ncm', maskNCM(e.target.value))} className="w-24 text-xs" placeholder="NCM" maxLength={10} />
                        </TableCell>
                        <TableCell className="align-middle">
                          <Input value={item.cfop} onChange={(e) => updateManualItem(index, 'cfop', maskCFOP(e.target.value))} className="w-20 text-xs" placeholder="1102" maxLength={4} />
                        </TableCell>
                        <TableCell className="align-middle">
                          <Input type="number" min={0} step="0.01" value={item.quantidade} onChange={(e) => updateManualItem(index, 'quantidade', parseFloat(e.target.value) || 0)} className="w-20 text-right text-xs" />
                        </TableCell>
                        <TableCell className="align-middle">
                          <Input value={item.unidade} onChange={(e) => updateManualItem(index, 'unidade', e.target.value)} className="w-16 text-xs text-center" />
                        </TableCell>
                        <TableCell className="align-middle">
                          <Input type="number" min={0} step="0.01" value={item.valorUnitario} onChange={(e) => updateManualItem(index, 'valorUnitario', parseFloat(e.target.value) || 0)} className="w-24 text-right text-xs" />
                        </TableCell>
                        <TableCell className="text-right font-medium align-middle text-xs text-emerald-700">
                          {formatCurrency(item.quantidade * item.valorUnitario)}
                        </TableCell>
                        <TableCell className="align-middle">
                          {manualItems.length > 1 && (
                            <Button size="sm" variant="ghost" onClick={() => removeManualItem(index)} className="text-red-500 hover:text-red-700 h-8 w-8 p-0">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Financial Summary */}
            <div className="p-4 bg-zinc-50 rounded-lg space-y-2">
              <p className="font-semibold text-sm">Resumo Financeiro</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="text-zinc-500">Subtotal:</span>
                  <span className="ml-1 font-medium">{formatCurrency(manualSubtotal)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Frete:</span>
                  <span className="ml-1 font-medium">{formatCurrency(manualForm.frete)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Seguro:</span>
                  <span className="ml-1 font-medium">{formatCurrency(manualForm.seguro)}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Desconto:</span>
                  <span className="ml-1 font-medium text-red-600">-{formatCurrency(manualForm.desconto)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="font-semibold text-emerald-700">Total NF-e:</span>
                <span className="text-xl font-bold text-emerald-700">{formatCurrency(manualTotal)}</span>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)}>Cancelar</Button>
            <Button onClick={handleManualSave} disabled={manualSaving} className="bg-emerald-600 hover:bg-emerald-700">
              {manualSaving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Plus className="w-4 h-4 mr-1" />}
              Criar NF-e
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Invoice Dialog */}
      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancelar Nota Fiscal</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-zinc-600">Tem certeza que deseja cancelar esta nota fiscal? Esta ação não pode ser desfeita.</p>
            <div className="space-y-2">
              <Label htmlFor="cancelMotivo">Motivo do Cancelamento *</Label>
              <Textarea
                id="cancelMotivo"
                placeholder="Informe o motivo do cancelamento..."
                value={cancelMotivo}
                onChange={(e) => setCancelMotivo(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>Cancelar</Button>
            <Button
              onClick={handleCancelClientInvoice}
              disabled={cancelLoading || !cancelMotivo.trim()}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {cancelLoading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Confirmar Cancelamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Client Invoice Document Dialog */}
      <Dialog open={showClientInvoiceDoc} onOpenChange={setShowClientInvoiceDoc}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nota Fiscal Emitida</DialogTitle>
          </DialogHeader>
          {selectedClientInvoice && (
            <ClientInvoiceDoc
              invoice={selectedClientInvoice}
              onClose={() => setShowClientInvoiceDoc(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Product Search Dialog for Manual Grid Entry */}
      <Dialog open={productSearchOpen} onOpenChange={setProductSearchOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-zinc-900">
              <Search className="w-5 h-5 text-emerald-600" />
              Buscar Produto Cadastrado no Estoque
            </DialogTitle>
            <p className="text-xs text-zinc-500">
              Selecione o produto cadastrado para preencher automaticamente os dados do item na nota fiscal ou recibo de compra.
            </p>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <Input
                autoFocus
                placeholder="Filtrar por SKU, Descrição ou NCM..."
                value={productSearchQuery}
                onChange={(e) => setProductSearchQuery(e.target.value)}
                className="pl-9 text-sm"
              />
            </div>
          </div>

          <ScrollArea className="flex-1 border rounded-md max-h-[380px]">
            {loadingParts ? (
              <div className="flex items-center justify-center py-12 text-zinc-500">
                <Loader2 className="w-6 h-6 animate-spin mr-2 text-emerald-600" />
                Carregando produtos cadastrados...
              </div>
            ) : registeredParts.length === 0 ? (
              <div className="text-center py-12 text-zinc-400 text-sm">
                Nenhum produto cadastrado encontrado. Cadastre os produtos no módulo de Estoque.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>NCM</TableHead>
                    <TableHead>Unidade</TableHead>
                    <TableHead className="text-right">Estoque Atual</TableHead>
                    <TableHead className="text-right">Preço Custo</TableHead>
                    <TableHead className="text-center">Ação</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {registeredParts
                    .filter(p => {
                      if (!productSearchQuery.trim()) return true
                      const q = productSearchQuery.toLowerCase()
                      return (
                        p.sku?.toLowerCase().includes(q) ||
                        p.description?.toLowerCase().includes(q) ||
                        p.ncm?.toLowerCase().includes(q)
                      )
                    })
                    .map((part) => (
                      <TableRow
                        key={part.id}
                        className="cursor-pointer hover:bg-emerald-50/70 transition-colors"
                        onClick={() => selectProductForManualEntry(part)}
                      >
                        <TableCell className="font-mono text-xs font-bold text-zinc-800">{part.sku}</TableCell>
                        <TableCell className="font-medium text-zinc-900 text-sm">{part.description}</TableCell>
                        <TableCell className="text-xs text-zinc-500">{part.ncm || '—'}</TableCell>
                        <TableCell className="text-xs text-zinc-600">{part.unit}</TableCell>
                        <TableCell className="text-right font-medium text-xs">
                          <span className={part.quantity <= 0 ? 'text-amber-600 font-semibold' : 'text-zinc-800'}>
                            {part.quantity}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-semibold text-sm text-emerald-700">
                          {formatCurrency(part.costPrice)}
                        </TableCell>
                        <TableCell className="text-center">
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700 text-white h-7 px-2.5 text-xs gap-1"
                            onClick={(e) => {
                              e.stopPropagation()
                              selectProductForManualEntry(part)
                            }}
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Inserir
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
          </ScrollArea>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setProductSearchOpen(false)}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pricing & Profit Margin Modal */}
      <Dialog open={pricingOpen} onOpenChange={setPricingOpen}>
        <DialogContent className="max-w-[95vw] lg:max-w-6xl xl:max-w-7xl max-h-[92vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-bold text-zinc-900">
              <DollarSign className="w-6 h-6 text-emerald-600" />
              Precificação & Margem de Lucro dos Itens da Entrada
            </DialogTitle>
            <p className="text-xs text-zinc-500">
              Ajuste a margem de lucro individualmente para cada produto que deu entrada no estoque. Itens com margens diferentes podem ser configurados separadamente.
            </p>
          </DialogHeader>

          {/* Quick Toolbar: Global Margin */}
          <div className="bg-emerald-50/80 border border-emerald-200 rounded-lg p-3 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-emerald-900">Margem Padrão Rápida:</span>
              <div className="flex items-center gap-1">
                {[30, 40, 50, 70, 100].map((pct) => (
                  <Button
                    key={pct}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setGlobalMarginInput(String(pct))
                      applyGlobalMargin(pct)
                    }}
                    className="h-7 px-2 text-xs font-bold border-emerald-300 text-emerald-800 hover:bg-emerald-100"
                  >
                    {pct}%
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto">
              <Label className="text-xs font-medium text-emerald-900 shrink-0">Margem Global Customizada (%):</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={globalMarginInput}
                onChange={(e) => setGlobalMarginInput(e.target.value)}
                className="w-20 h-8 text-xs font-bold text-center bg-white"
              />
              <Button
                type="button"
                size="sm"
                className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-1"
                onClick={() => applyGlobalMargin(parseFloat(globalMarginInput) || 0)}
              >
                Aplicar em Todos os Itens
              </Button>
            </div>
          </div>

          {/* Items Pricing Table */}
          <ScrollArea className="flex-1 border rounded-md max-h-[420px] my-2">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50">
                  <TableHead>SKU / Código</TableHead>
                  <TableHead>Descrição do Produto</TableHead>
                  <TableHead className="text-right">Custo NF-e (R$)</TableHead>
                  <TableHead className="text-right">Venda Atual (R$)</TableHead>
                  <TableHead className="text-center w-36">Margem de Lucro (%)</TableHead>
                  <TableHead className="text-right w-40">Novo Preço Venda (R$)</TableHead>
                  <TableHead className="text-right">Lucro Unit. (R$)</TableHead>
                  <TableHead className="text-center">Estoque</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pricingItems.map((item, index) => (
                  <TableRow key={item.itemId} className="hover:bg-zinc-50/80">
                    <TableCell className="font-mono text-xs font-bold text-zinc-800">{item.sku}</TableCell>
                    <TableCell className="font-medium text-zinc-900 text-sm">{item.descricao}</TableCell>
                    <TableCell className="text-right font-medium text-xs text-zinc-700">
                      {formatCurrency(item.custoAtual)}
                    </TableCell>
                    <TableCell className="text-right text-xs text-zinc-500">
                      {item.precoVendaAtual > 0 ? formatCurrency(item.precoVendaAtual) : '—'}
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          step={0.5}
                          value={item.margemLucroPct}
                          onChange={(e) => updateItemMarginPct(index, parseFloat(e.target.value) || 0)}
                          className="w-20 h-8 text-center font-bold text-xs border-emerald-300 focus:ring-emerald-500"
                        />
                        <span className="text-xs font-semibold text-zinc-600">%</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        value={item.novoPrecoVenda}
                        onChange={(e) => updateItemSalePrice(index, parseFloat(e.target.value) || 0)}
                        className="w-28 h-8 text-right font-bold text-xs text-emerald-700 border-emerald-300 focus:ring-emerald-500 ml-auto"
                      />
                    </TableCell>
                    <TableCell className="text-right font-bold text-xs text-emerald-600">
                      +{formatCurrency(item.lucroBrutoUnit)}
                    </TableCell>
                    <TableCell className="text-center">
                      {item.partId ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 text-[10px]">
                          ✓ Vinc. Estoque
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-300 text-[10px]">
                          Não Vinc.
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>

          {/* Pricing Financial Summary */}
          <div className="p-3 bg-zinc-100/80 rounded-lg flex flex-wrap items-center justify-between gap-4 text-xs">
            <div>
              <span className="text-zinc-500">Total de Itens:</span>
              <span className="ml-1 font-bold text-zinc-900">{pricingItems.length}</span>
            </div>
            <div>
              <span className="text-zinc-500">Custo Total dos Itens:</span>
              <span className="ml-1 font-bold text-zinc-800">
                {formatCurrency(pricingItems.reduce((s, i) => s + i.custoAtual * i.quantidade, 0))}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Faturamento Projetado:</span>
              <span className="ml-1 font-bold text-emerald-700">
                {formatCurrency(pricingItems.reduce((s, i) => s + i.novoPrecoVenda * i.quantidade, 0))}
              </span>
            </div>
            <div>
              <span className="text-zinc-500">Lucro Bruto Projetado:</span>
              <span className="ml-1 font-bold text-emerald-800 text-sm">
                +{formatCurrency(pricingItems.reduce((s, i) => s + i.lucroBrutoUnit * i.quantidade, 0))}
              </span>
            </div>
          </div>

          <DialogFooter className="pt-3 gap-2">
            <Button variant="outline" onClick={() => setPricingOpen(false)} disabled={savingPricing}>
              Cancelar
            </Button>
            <Button
              onClick={handleSavePricing}
              disabled={savingPricing}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1.5"
            >
              {savingPricing ? <Loader2 className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
              Salvar e Atualizar Preços de Venda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
