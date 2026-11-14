'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { maskCPFCNPJ, formatCPFCNPJ } from '@/lib/validators'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  ShoppingCart,
  Search,
  Plus,
  Minus,
  Trash2,
  Loader2,
  CreditCard,
  Banknote,
  QrCode,
  X,
  Check,
  Receipt,
  User,
  Package,
  Tag,
  ArrowLeft,
  ChevronRight,
  Printer,
  FileText,
  Undo2,
} from 'lucide-react'

// =============================================
// TYPES
// =============================================
interface PartData {
  id: string
  sku: string
  description: string
  quantity: number
  salePrice: number
  costPrice: number
  unit: string
  minQuantity: number
  ncm?: string | null
  cfop?: string | null
  location?: string | null
  deleted?: boolean
}

interface ClientSimple {
  id: string
  name: string
  cpfCnpj?: string | null
  phone?: string | null
}

interface EmployeeSimple {
  id: string
  name: string
}

interface CartItem {
  partId: string
  description: string
  sku: string
  quantity: number
  unitPrice: number
  totalPrice: number
  available: number
  unit: string
}

interface SaleData {
  id: string
  number: string
  status: string
  discount: number
  totalAmount: number
  paymentMethod?: string | null
  paidAt?: string | null
  obs?: string | null
  clientId?: string | null
  client?: ClientSimple | null
  createdAt: string
  items: {
    id: string
    description: string
    quantity: number
    unitPrice: number
    totalPrice: number
    partId?: string | null
  }[]
}

// =============================================
// HELPERS
// =============================================
function formatCurrency(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
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

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  ABERTA: { label: 'Aberta', color: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  PAGA: { label: 'Paga', color: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  CANCELADA: { label: 'Cancelada', color: 'bg-red-100 text-red-800 border-red-200' },
  ESTORNADA: { label: 'Estornada', color: 'bg-orange-100 text-orange-800 border-orange-200' },
}

import { printReport, buildReportHeader, fmtCurrency, fmtDate } from '@/lib/print-utils'
import { PdvReceipt } from '@/components/modules/pdv-receipt'
import { ClientInvoiceDoc, type ClientInvoiceData } from '@/components/modules/client-invoice-doc'

// =============================================
// MAIN PDV COMPONENT
// =============================================
export function PDVModule() {
  const { user, office: authOffice } = useAuthStore()
  const officeId = user?.officeId || ''

  // Cart state
  const [cart, setCart] = useState<CartItem[]>([])
  const [discount, setDiscount] = useState(0)
  const [discountType, setDiscountType] = useState<'VALUE' | 'PERCENT'>('VALUE')
  const [obs, setObs] = useState('')
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)
  const [selectedClientName, setSelectedClientName] = useState('')

  // Product search
  const [searchTerm, setSearchTerm] = useState('')
  const [parts, setParts] = useState<PartData[]>([])
  const [catalogParts, setCatalogParts] = useState<PartData[]>([])
  const [loadingParts, setLoadingParts] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number>(-1)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Client search
  const [clientSearch, setClientSearch] = useState('')
  const [clients, setClients] = useState<ClientSimple[]>([])
  const [showClientPicker, setShowClientPicker] = useState(false)

  // Seller / Employees state
  const [employees, setEmployees] = useState<EmployeeSimple[]>([])
  const [selectedSellerId, setSelectedSellerId] = useState<string>('')

  // Fetch active employees for seller dropdown
  useEffect(() => {
    if (!officeId) return
    apiFetch(`/api/employees?officeId=${officeId}&active=true`).then((res) => {
      if (res.success && Array.isArray(res.data)) {
        setEmployees(res.data)
      }
    }).catch(() => {})
  }, [officeId])

  useEffect(() => {
    if (user?.id && !selectedSellerId) {
      setSelectedSellerId(user.id)
    }
  }, [user?.id, selectedSellerId])

  // Payment
  const [showPayment, setShowPayment] = useState(false)
  const [paymentMethod, setPaymentMethod] = useState<string>('')
  const [processing, setProcessing] = useState(false)

  // Sale history
  const [showHistory, setShowHistory] = useState(false)
  const [sales, setSales] = useState<SaleData[]>([])
  const [loadingSales, setLoadingSales] = useState(false)
  const [selectedSale, setSelectedSale] = useState<SaleData | null>(null)

  // Receipt modal
  const [showReceipt, setShowReceipt] = useState(false)
  const [receiptSale, setReceiptSale] = useState<SaleData | null>(null)

  // Client Invoice modal
  const [showClientInvoice, setShowClientInvoice] = useState(false)
  const [clientInvoiceData, setClientInvoiceData] = useState<ClientInvoiceData | null>(null)
  const [generatingNF, setGeneratingNF] = useState(false)
  // Cash Register State
  const [cashRegister, setCashRegister] = useState<{
    isOpen: boolean
    session: any | null
  }>({ isOpen: false, session: null })
  const [loadingCashRegister, setLoadingCashRegister] = useState(true)
  const [showOpenCashModal, setShowOpenCashModal] = useState(false)
  const [showCloseCashModal, setShowCloseCashModal] = useState(false)
  const [showMovementModal, setShowMovementModal] = useState(false)
  const [movementType, setMovementType] = useState<'SUPRIMENTO' | 'SANGRIA'>('SANGRIA')

  const [initialBalanceInput, setInitialBalanceInput] = useState('0')
  const [countedCashInput, setCountedCashInput] = useState('0')
  const [movementAmountInput, setMovementAmountInput] = useState('')
  const [movementDescInput, setMovementDescInput] = useState('')
  const [cashObsInput, setCashObsInput] = useState('')

  // Fetch Cash Register Status
  const fetchCashRegisterStatus = useCallback(async () => {
    if (!officeId) return
    setLoadingCashRegister(true)
    try {
      const res = await apiFetch(`/api/cash-register?officeId=${officeId}`)
      if (res.success) {
        setCashRegister({
          isOpen: !!res.isOpen,
          session: res.session || null,
        })
      }
    } catch (err) {
      console.error('Error fetching cash register status:', err)
    } finally {
      setLoadingCashRegister(false)
    }
  }, [officeId])

  useEffect(() => {
    fetchCashRegisterStatus()
  }, [fetchCashRegisterStatus])

  // Search debounce
  const searchTimeout = useRef<NodeJS.Timeout | null>(null)

  // =============================================
  // QUICK CATALOG (Loaded when search is empty)
  // =============================================
  const fetchCatalog = useCallback(async () => {
    if (!officeId) return
    try {
      const params = new URLSearchParams({ officeId, limit: '12' })
      const res = await apiFetch(`/api/parts?${params.toString()}`)
      if (res.success && Array.isArray(res.data)) {
        setCatalogParts(res.data.filter((p: PartData) => p.quantity > 0 && !p.deleted))
      }
    } catch {
      // silently handle
    }
  }, [officeId])

  useEffect(() => {
    fetchCatalog()
  }, [fetchCatalog])

  // Global hotkeys (F2 or Ctrl+K / Cmd+K to focus search input)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F2' || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
        e.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', handleGlobalKeyDown)
    return () => window.removeEventListener('keydown', handleGlobalKeyDown)
  }, [])

  // =============================================
  // PARTS SEARCH WITH SMART SORTING
  // =============================================
  const fetchParts = useCallback(async (term: string) => {
    if (!officeId || !term.trim()) {
      setParts([])
      setSelectedIndex(-1)
      return
    }
    setLoadingParts(true)
    try {
      const params = new URLSearchParams({ officeId, search: term, limit: '20' })
      const res = await apiFetch(`/api/parts?${params.toString()}`)
      if (res.success && Array.isArray(res.data)) {
        const cleanTerm = term.trim().toLowerCase()
        const availableParts = res.data.filter((p: PartData) => p.quantity > 0 && !p.deleted)
        
        // Smart sort: exact SKU match first, then description starts with, then rest
        const sorted = availableParts.sort((a: PartData, b: PartData) => {
          const aExactSKU = a.sku.toLowerCase() === cleanTerm
          const bExactSKU = b.sku.toLowerCase() === cleanTerm
          if (aExactSKU && !bExactSKU) return -1
          if (!aExactSKU && bExactSKU) return 1

          const aStartDesc = a.description.toLowerCase().startsWith(cleanTerm)
          const bStartDesc = b.description.toLowerCase().startsWith(cleanTerm)
          if (aStartDesc && !bStartDesc) return -1
          if (!aStartDesc && bStartDesc) return 1

          return 0
        })

        setParts(sorted)
        setSelectedIndex(sorted.length > 0 ? 0 : -1)

        // Barcode scanner instant match check: if exact SKU match, auto-add
        const exactSkuMatch = sorted.find((p: PartData) => p.sku.toLowerCase() === cleanTerm)
        if (exactSkuMatch && sorted.length === 1) {
          addToCart(exactSkuMatch)
        }
      }
    } catch {
      // silently handle
    } finally {
      setLoadingParts(false)
    }
  }, [officeId])

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(() => fetchParts(value), 250)
  }

  // Keyboard navigation for search dropdown
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (parts.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev + 1) % parts.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => (prev - 1 + parts.length) % parts.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const cleanTerm = searchTerm.trim().toLowerCase()
      const exactMatch = parts.find((p) => p.sku.toLowerCase() === cleanTerm)

      if (exactMatch) {
        addToCart(exactMatch)
      } else if (selectedIndex >= 0 && selectedIndex < parts.length) {
        addToCart(parts[selectedIndex])
      } else if (parts.length === 1) {
        addToCart(parts[0])
      }
    } else if (e.key === 'Escape') {
      setSearchTerm('')
      setParts([])
      setSelectedIndex(-1)
    }
  }

  // =============================================
  // CART OPERATIONS
  // =============================================
  const addToCart = (part: PartData) => {
    setCart(prev => {
      const existing = prev.find(item => item.partId === part.id)
      if (existing) {
        // Increment quantity
        const newQty = Math.min(existing.quantity + 1, part.quantity)
        return prev.map(item =>
          item.partId === part.id
            ? { ...item, quantity: newQty, totalPrice: newQty * item.unitPrice }
            : item
        )
      }
      return [...prev, {
        partId: part.id,
        description: part.description,
        sku: part.sku,
        quantity: 1,
        unitPrice: part.salePrice,
        totalPrice: part.salePrice,
        available: part.quantity,
        unit: part.unit,
      }]
    })
    setSearchTerm('')
    setParts([])
    setSelectedIndex(-1)
  }

  const updateQuantity = (partId: string, newQty: number) => {
    if (newQty <= 0) {
      removeFromCart(partId)
      return
    }
    setCart(prev => prev.map(item =>
      item.partId === partId
        ? { ...item, quantity: Math.min(newQty, item.available), totalPrice: Math.min(newQty, item.available) * item.unitPrice }
        : item
    ))
  }

  const removeFromCart = (partId: string) => {
    setCart(prev => prev.filter(item => item.partId !== partId))
  }

  const clearCart = () => {
    setCart([])
    setDiscount(0)
    setDiscountType('VALUE')
    setObs('')
    setSelectedClientId(null)
    setSelectedClientName('')
  }

  const subtotal = cart.reduce((sum, item) => sum + item.totalPrice, 0)
  const discountValue = discountType === 'PERCENT' ? (subtotal * discount) / 100 : discount
  const totalAmount = Math.max(0, subtotal - discountValue)

  // =============================================
  // CLIENT PICKER
  // =============================================
  const fetchClients = useCallback(async (term: string) => {
    if (!officeId) return
    try {
      const params = new URLSearchParams({ officeId, search: term, limit: '10' })
      const res = await apiFetch(`/api/clients?${params.toString()}`)
      if (res.success) setClients(res.data)
    } catch {
      // silently handle
    }
  }, [officeId])

  const selectClient = (client: ClientSimple) => {
    setSelectedClientId(client.id)
    setSelectedClientName(client.name)
    setShowClientPicker(false)
    setClientSearch('')
  }

  // =============================================
  // CASH REGISTER HANDLERS
  // =============================================
  const handleOpenCashRegister = async () => {
    try {
      const res = await apiFetch('/api/cash-register', {
        method: 'POST',
        body: JSON.stringify({
          officeId,
          action: 'OPEN',
          initialBalance: parseFloat(initialBalanceInput) || 0,
          obs: cashObsInput || undefined,
        }),
      })
      if (res.success) {
        setShowOpenCashModal(false)
        setCashObsInput('')
        fetchCashRegisterStatus()
      } else {
        alert(res.error || 'Erro ao abrir caixa')
      }
    } catch {
      alert('Erro de conexão ao abrir caixa')
    }
  }

  const handleCloseCashRegister = async () => {
    try {
      const res = await apiFetch('/api/cash-register', {
        method: 'POST',
        body: JSON.stringify({
          officeId,
          action: 'CLOSE',
          finalBalance: parseFloat(countedCashInput) || 0,
          obs: cashObsInput || undefined,
        }),
      })
      if (res.success) {
        setShowCloseCashModal(false)
        setCashObsInput('')
        fetchCashRegisterStatus()
        alert(`Caixa fechado com sucesso! Saldo Contado: ${formatCurrency(parseFloat(countedCashInput) || 0)}`)
      } else {
        alert(res.error || 'Erro ao fechar caixa')
      }
    } catch {
      alert('Erro de conexão ao fechar caixa')
    }
  }

  const handleCreateMovement = async () => {
    if (!movementAmountInput || parseFloat(movementAmountInput) <= 0) {
      alert('Informe um valor válido')
      return
    }
    try {
      const res = await apiFetch('/api/cash-register', {
        method: 'POST',
        body: JSON.stringify({
          officeId,
          action: 'MOVEMENT',
          type: movementType,
          amount: parseFloat(movementAmountInput),
          description: movementDescInput || undefined,
        }),
      })
      if (res.success) {
        setShowMovementModal(false)
        setMovementAmountInput('')
        setMovementDescInput('')
        fetchCashRegisterStatus()
      } else {
        alert(res.error || 'Erro ao registrar movimentação')
      }
    } catch {
      alert('Erro de conexão ao registrar movimentação')
    }
  }

  // =============================================
  // FINALIZE SALE
  // =============================================
  const handleFinalizeSale = async () => {
    if (!paymentMethod || cart.length === 0) return
    if (!cashRegister.isOpen) {
      alert('O Caixa está FECHADO! Por favor, abra o caixa antes de finalizar vendas.')
      setShowPayment(false)
      setShowOpenCashModal(true)
      return
    }

    setProcessing(true)
    try {
      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          officeId,
          clientId: selectedClientId,
          sellerId: selectedSellerId || user?.id,
          discount: discountValue,
          paymentMethod,
          obs: obs || null,
          items: cart.map(item => ({
            partId: item.partId,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
          })),
        }),
      })

      if (res.success) {
        alert(`Venda ${res.data.number} finalizada com sucesso!`)
        clearCart()
        setShowPayment(false)
        setPaymentMethod('')
        fetchCashRegisterStatus()
      } else {
        alert(res.error || 'Erro ao finalizar venda')
      }
    } catch {
      alert('Erro de conexão com o servidor')
    } finally {
      setProcessing(false)
    }
  }

  // =============================================
  // SALE HISTORY
  // =============================================
  const fetchSales = useCallback(async () => {
    if (!officeId) return
    setLoadingSales(true)
    try {
      const res = await apiFetch(`/api/sales?officeId=${officeId}&limit=50`)
      if (res.success) setSales(res.data)
    } catch {
      // silently handle
    } finally {
      setLoadingSales(false)
    }
  }, [officeId])

  const fetchSaleDetail = async (id: string) => {
    try {
      const res = await apiFetch(`/api/sales/${id}`)
      if (res.success) setSelectedSale(res.data)
    } catch {
      // silently handle
    }
  }

  const handleCancelSale = async (saleId: string) => {
    if (!confirm('Deseja realmente cancelar esta venda? O estoque será devolvido.')) return
    try {
      const res = await apiFetch(`/api/sales/${saleId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'CANCELADA' }),
      })
      if (res.success) {
        fetchSales()
        setSelectedSale(null)
      } else {
        alert(res.error || 'Erro ao cancelar venda')
      }
    } catch {
      alert('Erro de conexão')
    }
  }

  /**
   * Estorno de venda paga: devolve o dinheiro no financeiro (lançamento
   * compensatório) e o estoque, e marca a venda como ESTORNADA. Nada é apagado.
   */
  const handleReverseSale = async (saleId: string) => {
    const reason = prompt('Motivo do estorno (obrigatório, fica na trilha de auditoria):')
    if (!reason || reason.trim().length < 3) {
      if (reason !== null) alert('Informe um motivo com pelo menos 3 caracteres')
      return
    }
    if (!confirm('Estornar esta venda? O valor volta ao financeiro e o estoque é devolvido.')) return
    try {
      const res = await apiFetch(`/api/sales/${saleId}/estorno`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim() }),
      })
      if (res.success) {
        fetchSales()
        if (selectedSale?.id === saleId) setSelectedSale(res.data?.sale ?? null)
      } else {
        alert(res.error || 'Erro ao estornar venda')
      }
    } catch {
      alert('Erro de conexão')
    }
  }

  const handlePaySale = async (saleId: string, method: string) => {
    try {
      const res = await apiFetch(`/api/sales/${saleId}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'PAGA', paymentMethod: method }),
      })
      if (res.success) {
        fetchSales()
        if (selectedSale?.id === saleId) {
          setSelectedSale(res.data)
        }
      } else {
        alert(res.error || 'Erro ao registrar pagamento')
      }
    } catch {
      alert('Erro de conexão')
    }
  }

  // Show sale receipt modal
  const handleShowReceipt = (sale: SaleData) => {
    setReceiptSale(sale)
    setShowReceipt(true)
  }

  // Emit NF for a sale
  const handleEmitNF = async (sale: SaleData) => {
    if (!officeId) return
    setGeneratingNF(true)
    try {
      const res = await apiFetch('/api/client-invoices', {
        method: 'POST',
        body: JSON.stringify({
          officeId,
          type: 'VENDA',
          saleId: sale.id,
        }),
      })
      if (res.success && res.data) {
        // Fetch full invoice with office info for the document
        const detailRes = await apiFetch(`/api/client-invoices/${res.data.id}?officeId=${officeId}`)
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

  // =============================================
  // HISTORY VIEW
  // =============================================
  if (showHistory) {
    return (
    <>
      <div className="p-4 md:p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => { setShowHistory(false); setSelectedSale(null) }} className="gap-1">
              <ArrowLeft className="w-4 h-4" /> Voltar ao PDV
            </Button>
            <h1 className="text-2xl font-bold text-zinc-900">Histórico de Vendas</h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchSales()} className="gap-1">
            <Receipt className="w-3.5 h-3.5" /> Atualizar
          </Button>
        </div>

        {selectedSale ? (
          <Card className="border-zinc-200/60">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Venda {selectedSale.number}</CardTitle>
                  <p className="text-sm text-zinc-500">{formatDate(selectedSale.createdAt)}</p>
                </div>
                <Badge variant="outline" className={STATUS_CONFIG[selectedSale.status]?.color || ''}>
                  {STATUS_CONFIG[selectedSale.status]?.label || selectedSale.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {selectedSale.client && (
                <div className="flex items-center gap-2 text-sm">
                  <User className="w-4 h-4 text-zinc-400" />
                  <span className="text-zinc-700">{selectedSale.client.name}</span>
                  {selectedSale.client.cpfCnpj && (
                    <span className="text-zinc-500">({formatCPFCNPJ(selectedSale.client.cpfCnpj)})</span>
                  )}
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-center">Qtd</TableHead>
                    <TableHead className="text-right">Unitário</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {selectedSale.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium text-zinc-900">{item.description}</TableCell>
                      <TableCell className="text-center">{item.quantity}</TableCell>
                      <TableCell className="text-right">{formatCurrency(item.unitPrice)}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(item.totalPrice)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="flex justify-end">
                <div className="w-64 space-y-1">
                  {selectedSale.discount > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-500">Desconto</span>
                      <span className="text-red-600">-{formatCurrency(selectedSale.discount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-lg">
                    <span>Total</span>
                    <span className="text-emerald-700">{formatCurrency(selectedSale.totalAmount)}</span>
                  </div>
                  {selectedSale.paymentMethod && (
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-500">Pagamento</span>
                      <span>{selectedSale.paymentMethod}</span>
                    </div>
                  )}
                </div>
              </div>
              {selectedSale.status === 'ABERTA' && (
                <div className="flex gap-2 pt-2">
                  <Button
                    onClick={() => handlePaySale(selectedSale.id, 'DINHEIRO')}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1"
                    size="sm"
                  >
                    <Banknote className="w-4 h-4" /> Dinheiro
                  </Button>
                  <Button
                    onClick={() => handlePaySale(selectedSale.id, 'PIX')}
                    className="bg-blue-600 hover:bg-blue-700 text-white gap-1"
                    size="sm"
                  >
                    <QrCode className="w-4 h-4" /> PIX
                  </Button>
                  <Button
                    onClick={() => handlePaySale(selectedSale.id, 'CARTAO')}
                    className="bg-purple-600 hover:bg-purple-700 text-white gap-1"
                    size="sm"
                  >
                    <CreditCard className="w-4 h-4" /> Cartão
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleCancelSale(selectedSale.id)}
                    className="text-red-600 border-red-200 hover:bg-red-50 gap-1"
                    size="sm"
                  >
                    <Trash2 className="w-4 h-4" /> Cancelar
                  </Button>
                </div>
              )}
              {selectedSale.status === 'PAGA' && (
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => handleShowReceipt(selectedSale)}
                    className="gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    size="sm"
                  >
                    <Printer className="w-4 h-4" /> Ver Recibo
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleEmitNF(selectedSale)}
                    disabled={generatingNF}
                    className="gap-1 border-amber-200 text-amber-700 hover:bg-amber-50"
                    size="sm"
                  >
                    {generatingNF ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Emitir Nota Fiscal
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleReverseSale(selectedSale.id)}
                    className="text-orange-600 border-orange-200 hover:bg-orange-50 gap-1"
                    size="sm"
                  >
                    <Undo2 className="w-4 h-4" /> Estornar
                  </Button>
                </div>
              )}
              {selectedSale.status === 'ESTORNADA' && (
                <div className="flex gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => handleShowReceipt(selectedSale)}
                    className="gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                    size="sm"
                  >
                    <Printer className="w-4 h-4" /> Ver Recibo
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => handleCancelSale(selectedSale.id)}
                    className="text-red-600 border-red-200 hover:bg-red-50 gap-1"
                    size="sm"
                  >
                    <Trash2 className="w-4 h-4" /> Cancelar Venda
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <Card className="border-zinc-200/60">
            <CardContent className="p-0">
              {loadingSales ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-600" />
                  <span className="ml-2 text-zinc-500">Carregando vendas...</span>
                </div>
              ) : sales.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16">
                  <Receipt className="w-12 h-12 text-zinc-300 mb-3" />
                  <p className="text-zinc-500">Nenhuma venda registrada</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Número</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Pagamento</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Data</TableHead>
                      <TableHead className="text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sales.map((sale) => (
                      <TableRow key={sale.id} className="cursor-pointer hover:bg-emerald-50/50" onClick={() => fetchSaleDetail(sale.id)}>
                        <TableCell className="font-medium text-zinc-900">{sale.number}</TableCell>
                        <TableCell className="text-zinc-600">{sale.client?.name || 'Consumidor'}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={STATUS_CONFIG[sale.status]?.color || ''}>
                            {STATUS_CONFIG[sale.status]?.label || sale.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-zinc-600">{sale.paymentMethod || '—'}</TableCell>
                        <TableCell className="text-right font-medium text-emerald-700">{formatCurrency(sale.totalAmount)}</TableCell>
                        <TableCell className="text-zinc-500 text-sm">{formatDate(sale.createdAt)}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={(e) => { e.stopPropagation(); fetchSaleDetail(sale.id) }}>
                            <ChevronRight className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Receipt Modal */}
      <Dialog open={showReceipt} onOpenChange={setShowReceipt}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto flex flex-col items-center">
          <DialogHeader>
            <DialogTitle>Recibo de Venda</DialogTitle>
          </DialogHeader>
          {receiptSale && authOffice && (
            <PdvReceipt
              sale={receiptSale}
              office={{
                name: authOffice.name || 'KiteOS',
                cnpj: authOffice.cnpj || '',
                email: authOffice.email || '',
                phone: authOffice.phone,
                address: authOffice.address,
                city: authOffice.city,
                state: authOffice.state,
                logo: authOffice.logo,
              }}
              onClose={() => setShowReceipt(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Client Invoice Modal */}
      <Dialog open={showClientInvoice} onOpenChange={setShowClientInvoice}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nota Fiscal de Venda</DialogTitle>
          </DialogHeader>
          {clientInvoiceData && (
            <ClientInvoiceDoc
              invoice={clientInvoiceData}
              onClose={() => setShowClientInvoice(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
    )
  }

  // =============================================
  // PDV MAIN VIEW
  // =============================================
  return (
    <div className="h-screen flex flex-col bg-zinc-50 overflow-hidden">
      {/* Top Bar */}
      <div className="bg-white border-b border-zinc-200 px-4 py-2.5 flex items-center justify-between shrink-0 flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-5 h-5 text-emerald-600" />
            <h1 className="text-lg font-bold text-zinc-900">PDV</h1>
          </div>

          {/* Seller / Operator Badge / Selector */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-zinc-100 border border-zinc-200 text-xs font-semibold text-zinc-700">
            <User className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-zinc-500">Vendedor:</span>
            {employees.length > 0 ? (
              <select
                value={selectedSellerId || user?.id || ''}
                onChange={(e) => setSelectedSellerId(e.target.value)}
                className="bg-transparent font-semibold text-zinc-800 border-none outline-none cursor-pointer py-0 text-xs"
              >
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            ) : (
              <span>{user?.name || 'Operador'}</span>
            )}
          </div>

          {/* Cash Register Status Badge & Quick Controls */}
          {cashRegister.isOpen ? (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-300 font-semibold text-xs gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Caixa Aberto
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setMovementType('SANGRIA'); setShowMovementModal(true) }}
                className="h-7 text-xs border-amber-200 text-amber-800 hover:bg-amber-50"
              >
                Sangria / Aporte
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowCloseCashModal(true)}
                className="h-7 text-xs border-red-200 text-red-700 hover:bg-red-50"
              >
                Fechar Caixa
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-red-50 text-red-700 border-red-300 font-semibold text-xs gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500"></span>
                Caixa Fechado
              </Badge>
              <Button
                size="sm"
                onClick={() => setShowOpenCashModal(true)}
                className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              >
                Abrir Caixa
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Client indicator */}
          {selectedClientId ? (
            <div className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-200 text-sm">
              <User className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-emerald-800 font-medium">{selectedClientName}</span>
              <button onClick={() => { setSelectedClientId(null); setSelectedClientName('') }} className="ml-1 text-emerald-400 hover:text-red-500">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setShowClientPicker(true)} className="gap-1 text-zinc-500">
              <User className="w-3.5 h-3.5" /> Cliente
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { setShowHistory(true); fetchSales() }} className="gap-1">
            <Receipt className="w-3.5 h-3.5" /> Histórico
          </Button>
        </div>
      </div>

      {/* Main Content - Split layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Product Search & Grid */}
        <div className="flex-1 flex flex-col p-4 overflow-hidden">
          {/* Search bar */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <Input
              ref={searchInputRef}
              placeholder="Buscar peça por nome, SKU, código de barras ou localização... (Pressione F2)"
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="pl-9 pr-16 h-11 text-base border-zinc-200 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 shadow-sm"
              autoFocus
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 text-[10px] font-semibold text-zinc-500 bg-zinc-100 border border-zinc-200 rounded">F2</kbd>
            </div>
          </div>

          {/* Search Results Dropdown */}
          {searchTerm && (
            <div className="mb-4 max-h-80 overflow-y-auto rounded-xl border border-emerald-100 bg-white shadow-xl flex flex-col divide-y divide-zinc-100">
              {loadingParts ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                  <span className="ml-2 text-sm text-zinc-500">Buscando no estoque...</span>
                </div>
              ) : parts.length === 0 ? (
                <div className="py-8 text-center text-zinc-400 text-sm">
                  Nenhuma peça encontrada para &quot;<span className="font-semibold text-zinc-700">{searchTerm}</span>&quot;
                </div>
              ) : (
                <>
                  <div className="px-3 py-1.5 bg-zinc-50 text-[11px] font-semibold text-zinc-500 uppercase tracking-wider flex justify-between">
                    <span>{parts.length} resultado(s) encontrado(s)</span>
                    <span className="hidden sm:inline">Use ↑↓ para selecionar e ↵ Enter para adicionar</span>
                  </div>
                  {parts.map((part, index) => {
                    const isSelected = index === selectedIndex
                    const isLowStock = part.quantity <= (part.minQuantity || 0)
                    return (
                      <button
                        key={part.id}
                        onClick={() => addToCart(part)}
                        onMouseEnter={() => setSelectedIndex(index)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all ${
                          isSelected
                            ? 'bg-emerald-50/90 text-emerald-950 font-medium ring-1 ring-inset ring-emerald-400'
                            : 'hover:bg-zinc-50 text-zinc-800'
                        }`}
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isSelected ? 'bg-emerald-200/60 text-emerald-800' : 'bg-zinc-100 text-zinc-500'}`}>
                          <Package className="w-4 h-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-zinc-900 truncate text-sm">{part.description}</span>
                            <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 bg-zinc-50 border-zinc-200 shrink-0">
                              SKU: {part.sku}
                            </Badge>
                            {part.location && (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-blue-50 text-blue-700 border-blue-200 shrink-0">
                                {part.location}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-xs text-zinc-500 mt-0.5">
                            <span className={`font-medium ${isLowStock ? 'text-amber-600' : 'text-zinc-600'}`}>
                              Estoque: {part.quantity} {part.unit} {isLowStock && '(Baixo)'}
                            </span>
                            {part.ncm && <span>NCM: {part.ncm}</span>}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="font-bold text-emerald-700 text-base">{formatCurrency(part.salePrice)}</p>
                        </div>
                        <div className={`p-1 rounded-md shrink-0 ${isSelected ? 'bg-emerald-600 text-white' : 'text-zinc-300'}`}>
                          <Plus className="w-4 h-4" />
                        </div>
                      </button>
                    )
                  })}
                  <div className="px-3 py-1.5 bg-zinc-50 text-[11px] text-zinc-400 flex items-center justify-between border-t border-zinc-100">
                    <div className="flex gap-3">
                      <span><kbd className="px-1 py-0.5 bg-white border rounded">↵ Enter</kbd> Adicionar</span>
                      <span><kbd className="px-1 py-0.5 bg-white border rounded">↑↓</kbd> Navegar</span>
                      <span><kbd className="px-1 py-0.5 bg-white border rounded">Esc</kbd> Limpar</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Cart Items or Quick Catalog */}
          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 && !searchTerm ? (
              <div className="flex flex-col h-full">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                    <Tag className="w-3.5 h-3.5 text-emerald-600" /> Catálogo Rápido · Peças em Estoque
                  </span>
                  <span className="text-xs text-zinc-400">Clique para adicionar ao carrinho</span>
                </div>
                {catalogParts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center flex-1 text-zinc-300">
                    <ShoppingCart className="w-16 h-16 mb-3 text-zinc-200" />
                    <p className="text-base font-medium text-zinc-400">Carrinho vazio</p>
                    <p className="text-xs text-zinc-400">Digite no campo acima para pesquisar peças</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5 pb-2">
                    {catalogParts.map((part) => (
                      <button
                        key={part.id}
                        onClick={() => addToCart(part)}
                        className="flex flex-col justify-between p-3 rounded-xl border border-zinc-200/80 bg-white hover:border-emerald-300 hover:shadow-md transition-all text-left group"
                      >
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 text-zinc-500 border-zinc-200">
                              {part.sku}
                            </Badge>
                            <span className="text-[10px] text-zinc-400">Disp: {part.quantity} {part.unit}</span>
                          </div>
                          <p className="font-medium text-zinc-900 text-xs line-clamp-2 group-hover:text-emerald-700 transition-colors">
                            {part.description}
                          </p>
                        </div>
                        <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-100">
                          <span className="font-bold text-emerald-700 text-sm">{formatCurrency(part.salePrice)}</span>
                          <span className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white flex items-center justify-center transition-colors">
                            <Plus className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : cart.length === 0 && searchTerm ? null : (
              <div className="space-y-2">
                {cart.map((item) => (
                  <Card key={item.partId} className="border-zinc-200/60 shadow-sm">
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-zinc-900 truncate">{item.description}</p>
                          <p className="text-xs text-zinc-500">SKU: {item.sku} · {formatCurrency(item.unitPrice)}/{item.unit}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => updateQuantity(item.partId, item.quantity - 1)}
                          >
                            <Minus className="w-3 h-3" />
                          </Button>
                          <Input
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateQuantity(item.partId, parseInt(e.target.value) || 0)}
                            className="w-14 h-7 text-center text-sm p-0"
                            min={1}
                            max={item.available}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => updateQuantity(item.partId, item.quantity + 1)}
                          >
                            <Plus className="w-3 h-3" />
                          </Button>
                        </div>
                        <div className="w-24 text-right shrink-0">
                          <p className="font-bold text-zinc-900">{formatCurrency(item.totalPrice)}</p>
                          <p className="text-[10px] text-zinc-400">Disp: {item.available}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-400 hover:text-red-600 shrink-0"
                          onClick={() => removeFromCart(item.partId)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Summary Panel */}
        <div className="w-80 border-l border-zinc-200 bg-white flex flex-col shrink-0">
          <div className="p-4 border-b border-zinc-100">
            <h2 className="font-semibold text-zinc-900 flex items-center gap-2">
              <Tag className="w-4 h-4 text-emerald-600" />
              Resumo da Venda
            </h2>
          </div>

          <div className="flex-1 p-4 space-y-4 overflow-y-auto">
            {/* Items count */}
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Itens no carrinho</span>
              <span className="font-medium text-zinc-900">{cart.length}</span>
            </div>

            {/* Subtotal */}
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Subtotal</span>
              <span className="font-medium text-zinc-900">{formatCurrency(subtotal)}</span>
            </div>

            {/* Discount */}
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-500">Desconto</Label>
                <div className="flex items-center gap-1 bg-zinc-100 rounded-md p-0.5">
                  <button
                    type="button"
                    onClick={() => { setDiscountType('VALUE'); setDiscount(0) }}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                      discountType === 'VALUE' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                    }`
                  }
                  >
                    R$
                  </button>
                  <button
                    type="button"
                    onClick={() => { setDiscountType('PERCENT'); setDiscount(0) }}
                    className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                      discountType === 'PERCENT' ? 'bg-white text-emerald-700 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                    }`
                  }
                  >
                    %
                  </button>
                </div>
              </div>
              <Input
                type="number"
                value={discount || ''}
                onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                placeholder={discountType === 'VALUE' ? '0,00' : '0'}
                min={0}
                max={discountType === 'PERCENT' ? 100 : subtotal}
                step={discountType === 'PERCENT' ? 1 : 0.01}
                className="h-8 text-sm"
              />
              {discountType === 'PERCENT' && discount > 0 && (
                <p className="text-xs text-zinc-400">
                  {discount}% = {formatCurrency(discountValue)} de desconto
                </p>
              )}
            </div>

            {/* Observation */}
            <div className="space-y-1">
              <Label className="text-xs text-zinc-500">Observação</Label>
              <Input
                value={obs}
                onChange={(e) => setObs(e.target.value)}
                placeholder="Observação da venda..."
                className="h-8 text-sm"
              />
            </div>

            <Separator />

            {/* Total */}
            <div className="flex justify-between items-center">
              <span className="text-lg font-bold text-zinc-900">Total</span>
              <span className="text-2xl font-bold text-emerald-700">{formatCurrency(totalAmount)}</span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="p-4 space-y-2 border-t border-zinc-100">
            <Button
              onClick={() => setShowPayment(true)}
              disabled={cart.length === 0}
              className="w-full h-12 text-base font-bold bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
            >
              <CreditCard className="w-5 h-5" />
              Finalizar Venda
            </Button>
            <Button
              variant="outline"
              onClick={clearCart}
              disabled={cart.length === 0}
              className="w-full text-zinc-500 gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" /> Limpar Carrinho
            </Button>
          </div>
        </div>
      </div>

      {/* ============================================= */}
      {/* PAYMENT DIALOG */}
      {/* ============================================= */}
      <Dialog open={showPayment} onOpenChange={setShowPayment}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-zinc-900">Finalizar Venda</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Sale summary */}
            <div className="p-4 rounded-lg bg-zinc-50 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Itens</span>
                <span className="font-medium">{cart.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Subtotal</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              {discountValue > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-zinc-500">Desconto {discountType === 'PERCENT' ? `(${discount}%)` : ''}</span>
                  <span className="text-red-600">-{formatCurrency(discountValue)}</span>
                </div>
              )}
              <Separator />
              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="text-emerald-700">{formatCurrency(totalAmount)}</span>
              </div>
              {selectedClientId && (
                <div className="flex items-center gap-1 text-sm text-zinc-500 pt-1">
                  <User className="w-3.5 h-3.5" /> {selectedClientName}
                </div>
              )}
            </div>

            {/* Payment method selection */}
            <div className="space-y-2">
              <Label className="text-sm font-medium text-zinc-700">Forma de Pagamento *</Label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setPaymentMethod('DINHEIRO')}
                  className={`flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 transition-all ${
                    paymentMethod === 'DINHEIRO'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                      : 'border-zinc-200 hover:border-zinc-300 text-zinc-600'
                  }`}
                >
                  <Banknote className="w-6 h-6" />
                  <span className="text-xs font-medium">Dinheiro</span>
                </button>
                <button
                  onClick={() => setPaymentMethod('PIX')}
                  className={`flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 transition-all ${
                    paymentMethod === 'PIX'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-zinc-200 hover:border-zinc-300 text-zinc-600'
                  }`}
                >
                  <QrCode className="w-6 h-6" />
                  <span className="text-xs font-medium">PIX</span>
                </button>
                <button
                  onClick={() => setPaymentMethod('CARTAO')}
                  className={`flex flex-col items-center gap-1.5 p-4 rounded-xl border-2 transition-all ${
                    paymentMethod === 'CARTAO'
                      ? 'border-purple-500 bg-purple-50 text-purple-700'
                      : 'border-zinc-200 hover:border-zinc-300 text-zinc-600'
                  }`}
                >
                  <CreditCard className="w-6 h-6" />
                  <span className="text-xs font-medium">Cartão</span>
                </button>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowPayment(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleFinalizeSale}
              disabled={!paymentMethod || processing}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 min-w-[140px]"
            >
              {processing ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              {processing ? 'Processando...' : 'Confirmar Venda'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================= */}
      {/* CLIENT PICKER DIALOG */}
      {/* ============================================= */}
      <Dialog open={showClientPicker} onOpenChange={setShowClientPicker}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-zinc-900">Selecionar Cliente</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
              <Input
                placeholder="Buscar por nome ou CPF..."
                value={clientSearch}
                onChange={(e) => {
                  setClientSearch(e.target.value)
                  fetchClients(e.target.value)
                }}
                className="pl-9"
              />
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1">
              {clients.length === 0 ? (
                <p className="text-center py-8 text-sm text-zinc-400">
                  {clientSearch ? 'Nenhum cliente encontrado' : 'Digite para buscar clientes'}
                </p>
              ) : (
                clients.map((client) => (
                  <button
                    key={client.id}
                    onClick={() => selectClient(client)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-emerald-50 text-left transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center shrink-0">
                      <User className="w-4 h-4 text-zinc-500" />
                    </div>
                    <div>
                      <p className="font-medium text-zinc-900 text-sm">{client.name}</p>
                      {client.cpfCnpj && (
                        <p className="text-xs text-zinc-500">{formatCPFCNPJ(client.cpfCnpj)}</p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowClientPicker(false)}>
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================= */}
      {/* OPEN CASH REGISTER DIALOG */}
      {/* ============================================= */}
      <Dialog open={showOpenCashModal} onOpenChange={setShowOpenCashModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-900">
              <Banknote className="w-5 h-5 text-emerald-600" />
              Abertura de Caixa PDV
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200 text-xs text-emerald-800 flex items-center gap-2">
              <User className="w-4 h-4 shrink-0 text-emerald-600" />
              <span>Operador: <strong>{user?.name || 'Vendedor'}</strong></span>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Saldo Inicial (Troco em Dinheiro) *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500 font-bold">R$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={initialBalanceInput}
                  onChange={(e) => setInitialBalanceInput(e.target.value)}
                  className="pl-9 font-bold text-lg"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Observações (Opcional)</Label>
              <Input
                placeholder="Ex: Notas miúdas de troco..."
                value={cashObsInput}
                onChange={(e) => setCashObsInput(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowOpenCashModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleOpenCashRegister}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold gap-1"
            >
              <Check className="w-4 h-4" /> Abrir Caixa
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================= */}
      {/* CLOSE CASH REGISTER DIALOG */}
      {/* ============================================= */}
      <Dialog open={showCloseCashModal} onOpenChange={setShowCloseCashModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-900">
              <Receipt className="w-5 h-5 text-red-600" />
              Fechamento de Caixa - Turno
            </DialogTitle>
          </DialogHeader>

          {cashRegister.session ? (
            <div className="space-y-4 py-2">
              <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-200 text-xs space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Saldo Inicial (Troco):</span>
                  <span className="font-semibold">{formatCurrency(cashRegister.session.initialBalance)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">(+) Vendas em Dinheiro:</span>
                  <span className="font-semibold text-emerald-700">{formatCurrency(cashRegister.session.totalCashSales)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">(+) Suprimentos de Troco:</span>
                  <span className="font-semibold text-blue-700">{formatCurrency(cashRegister.session.totalSuprimentos)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">(-) Sangrias (Retiradas):</span>
                  <span className="font-semibold text-red-600">-{formatCurrency(cashRegister.session.totalSangrias)}</span>
                </div>
                <Separator />
                <div className="flex justify-between text-sm font-bold pt-1">
                  <span>Saldo Esperado na Gaveta (Dinheiro):</span>
                  <span className="text-emerald-800">{formatCurrency(cashRegister.session.expectedCashInHand)}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs bg-zinc-100/70 p-2.5 rounded-lg border">
                <div>
                  <span className="text-zinc-500 block">Vendas PIX:</span>
                  <span className="font-bold text-blue-700 text-sm">{formatCurrency(cashRegister.session.totalPixSales)}</span>
                </div>
                <div>
                  <span className="text-zinc-500 block">Vendas Cartão:</span>
                  <span className="font-bold text-purple-700 text-sm">{formatCurrency(cashRegister.session.totalCardSales)}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Valor em Dinheiro Contado na Gaveta (R$) *</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500 font-bold">R$</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={countedCashInput}
                    onChange={(e) => setCountedCashInput(e.target.value)}
                    className="pl-9 font-bold text-lg"
                    autoFocus
                  />
                </div>
                {(() => {
                  const diff = (parseFloat(countedCashInput) || 0) - Number(cashRegister.session.expectedCashInHand)
                  if (isNaN(diff)) return null
                  return (
                    <div className={`text-xs font-medium mt-1 ${diff === 0 ? 'text-emerald-600' : diff > 0 ? 'text-blue-600' : 'text-red-600'}`}>
                      Divergência / Sobra: {formatCurrency(diff)} {diff === 0 ? '(Bateu exato!)' : diff > 0 ? '(Sobra)' : '(Falta)'}
                    </div>
                  )
                })()}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Observações de Fechamento</Label>
                <Input
                  placeholder="Justificativa de divergência ou repasse..."
                  value={cashObsInput}
                  onChange={(e) => setCashObsInput(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <p className="text-sm text-zinc-500 py-4">Nenhum caixa aberto para este operador.</p>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCloseCashModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCloseCashRegister}
              className="bg-red-600 hover:bg-red-700 text-white font-semibold gap-1"
            >
              <Check className="w-4 h-4" /> Confirmar Fechamento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================= */}
      {/* SANGRIA / SUPRIMENTO MOVEMENT DIALOG */}
      {/* ============================================= */}
      <Dialog open={showMovementModal} onOpenChange={setShowMovementModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-900">
              <Banknote className="w-5 h-5 text-amber-600" />
              Movimentação de Caixa (Sangria / Aporte)
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Tipo de Movimentação *</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMovementType('SANGRIA')}
                  className={`p-3 rounded-lg border-2 text-xs font-bold transition-all ${
                    movementType === 'SANGRIA'
                      ? 'border-red-500 bg-red-50 text-red-700'
                      : 'border-zinc-200 text-zinc-600'
                  }`}
                >
                  SANGRIA (Retirada)
                </button>
                <button
                  type="button"
                  onClick={() => setMovementType('SUPRIMENTO')}
                  className={`p-3 rounded-lg border-2 text-xs font-bold transition-all ${
                    movementType === 'SUPRIMENTO'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-zinc-200 text-zinc-600'
                  }`}
                >
                  SUPRIMENTO (Aporte)
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Valor (R$) *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-zinc-500 font-bold">R$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder="0.00"
                  value={movementAmountInput}
                  onChange={(e) => setMovementAmountInput(e.target.value)}
                  className="pl-9 font-bold text-lg"
                  autoFocus
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Motivo / Descrição</Label>
              <Input
                placeholder={movementType === 'SANGRIA' ? 'Ex: Sangria periódica para cofre...' : 'Ex: Reforço de troco...'}
                value={movementDescInput}
                onChange={(e) => setMovementDescInput(e.target.value)}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowMovementModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateMovement}
              disabled={!movementAmountInput || parseFloat(movementAmountInput) <= 0}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-1"
            >
              <Check className="w-4 h-4" /> Registrar Movimentação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
