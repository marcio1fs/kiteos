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
  deleted?: boolean
}

interface ClientSimple {
  id: string
  name: string
  cpfCnpj?: string | null
  phone?: string | null
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
  const [loadingParts, setLoadingParts] = useState(false)

  // Client search
  const [clientSearch, setClientSearch] = useState('')
  const [clients, setClients] = useState<ClientSimple[]>([])
  const [showClientPicker, setShowClientPicker] = useState(false)

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

  // Search debounce
  const searchTimeout = useRef<NodeJS.Timeout | null>(null)

  // =============================================
  // PARTS SEARCH
  // =============================================
  const fetchParts = useCallback(async (term: string) => {
    if (!officeId || !term.trim()) {
      setParts([])
      return
    }
    setLoadingParts(true)
    try {
      const params = new URLSearchParams({ officeId, search: term, limit: '20' })
      const res = await apiFetch(`/api/parts?${params.toString()}`)
      if (res.success) {
        setParts(res.data.filter((p: PartData) => p.quantity > 0 && !p.deleted))
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
    searchTimeout.current = setTimeout(() => fetchParts(value), 300)
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
  // FINALIZE SALE
  // =============================================
  const handleFinalizeSale = async () => {
    if (!paymentMethod || cart.length === 0) return
    setProcessing(true)
    try {
      const res = await apiFetch('/api/sales', {
        method: 'POST',
        body: JSON.stringify({
          officeId,
          clientId: selectedClientId,
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
      <div className="bg-white border-b border-zinc-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <ShoppingCart className="w-5 h-5 text-emerald-600" />
          <h1 className="text-lg font-bold text-zinc-900">PDV - Ponto de Venda</h1>
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
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
            <Input
              placeholder="Buscar peça por nome, SKU ou código..."
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9 h-11 text-base border-zinc-200 focus:border-emerald-400"
              autoFocus
            />
          </div>

          {/* Search Results */}
          {searchTerm && (
            <div className="mb-4 max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white shadow-lg">
              {loadingParts ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-emerald-600" />
                </div>
              ) : parts.length === 0 ? (
                <div className="py-8 text-center text-zinc-400 text-sm">
                  Nenhuma peça encontrada para &quot;{searchTerm}&quot;
                </div>
              ) : (
                parts.map((part) => (
                  <button
                    key={part.id}
                    onClick={() => addToCart(part)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-emerald-50 border-b border-zinc-100 last:border-0 text-left transition-colors"
                  >
                    <div className="w-9 h-9 rounded-lg bg-zinc-100 flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-zinc-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-zinc-900 truncate">{part.description}</p>
                      <p className="text-xs text-zinc-500">SKU: {part.sku} · Estoque: {part.quantity} {part.unit}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-emerald-700">{formatCurrency(part.salePrice)}</p>
                      <p className="text-[10px] text-zinc-400">Custo: {formatCurrency(part.costPrice)}</p>
                    </div>
                    <Plus className="w-4 h-4 text-emerald-500 shrink-0" />
                  </button>
                ))
              )}
            </div>
          )}

          {/* Cart Items */}
          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-zinc-300">
                <ShoppingCart className="w-16 h-16 mb-3" />
                <p className="text-lg font-medium text-zinc-400">Carrinho vazio</p>
                <p className="text-sm text-zinc-400">Busque e adicione peças acima</p>
              </div>
            ) : (
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
    </div>
  )
}
