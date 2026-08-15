'use client'

import { useRef, useCallback, useState, useEffect } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Printer, X, MessageCircle, Loader2, CheckCircle, AlertTriangle } from 'lucide-react'

// =============================================
// TYPES
// =============================================
interface PdvReceiptProps {
  sale: {
    id: string
    number: string
    status: string
    discount: number
    totalAmount: number
    paymentMethod?: string | null
    paidAt?: string | null
    createdAt: string
    user?: {
      name: string
    } | null
    client?: {
      name: string
      phone?: string | null
      cpfCnpj?: string | null
    } | null
    items: {
      description: string
      quantity: number
      unitPrice: number
      totalPrice: number
    }[]
  }
  office: {
    name: string
    cnpj: string
    email: string
    phone?: string | null
    address?: string | null
    city?: string | null
    state?: string | null
    logo?: string | null
  }
  onClose?: () => void
}

// =============================================
// FORMAT HELPERS
// =============================================
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatCNPJ(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) return cnpj
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

function formatCPFCpf(cpfCnpj: string): string {
  const digits = cpfCnpj.replace(/\D/g, '')
  if (digits.length === 14) return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
  if (digits.length === 11) return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4')
  return cpfCnpj
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11) return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  if (digits.length === 10) return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  return phone
}

function getPaymentMethodLabel(method: string): string {
  switch (method) {
    case 'PIX': return 'PIX'
    case 'CARTAO': return 'Cartão'
    case 'DINHEIRO': return 'Dinheiro'
    default: return method
  }
}

/**
 * Resolve logo URL for display.
 */
function resolveLogoUrl(logo: string | null | undefined): string | null {
  if (!logo) return null
  if (logo.startsWith('http') || logo.startsWith('data:')) return logo
  return logo.replace(/^\/uploads\//, '/api/uploads/')
}

// =============================================
// DASHED LINE COMPONENT
// =============================================
function DashedLine() {
  return (
    <div
      style={{
        borderBottom: '1px dashed #333',
        margin: '8px 0',
        width: '100%',
      }}
    />
  )
}

// =============================================
// RECEIPT CONTENT (used both for display and print)
// =============================================
function ReceiptContent({ sale, office }: Omit<PdvReceiptProps, 'onClose'>) {
  const isPaid = sale.status === 'PAGA'

  return (
    <div
      id="pdv-receipt-content"
      style={{
        fontFamily: "'Courier New', Courier, monospace",
        fontSize: '12px',
        lineHeight: '1.5',
        color: '#000',
        maxWidth: '302px',
        width: '100%',
        margin: '0 auto',
        padding: '12px 8px',
        background: '#fff',
      }}
    >
      {/* ===== HEADER ===== */}
      {office.logo && (
        <div style={{ textAlign: 'center', marginBottom: '8px' }}>
          <img
            src={resolveLogoUrl(office.logo) || undefined}
            alt={office.name}
            style={{
              maxHeight: '120px',
              maxWidth: '200px',
              objectFit: 'contain',
              display: 'inline-block',
            }}
          />
        </div>
      )}

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 'bold', fontSize: '16px', letterSpacing: '0.5px' }}>
          {office.name}
        </div>
        <div>CNPJ: {formatCNPJ(office.cnpj)}</div>
        {office.address && <div>{office.address}</div>}
        {(office.city || office.state) && (
          <div>
            {[office.city, office.state].filter(Boolean).join(' - ')}
          </div>
        )}
        {office.phone && <div>Tel: {formatPhone(office.phone)}</div>}
      </div>

      <DashedLine />

      {/* ===== SALE INFO ===== */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 'bold', fontSize: '14px', letterSpacing: '1px' }}>
          RECIBO DE VENDA
        </div>
      </div>

      <DashedLine />

      <div>
        <div>
          <strong>Venda:</strong> {sale.number}
        </div>
        <div>
          <strong>Data:</strong> {formatDate(sale.createdAt)}
        </div>
        {sale.user?.name && (
          <div>
            <strong>Vendedor:</strong> {sale.user.name}
          </div>
        )}
      </div>

      <DashedLine />

      {/* ===== CLIENT ===== */}
      {sale.client && (
        <div style={{ marginBottom: '6px' }}>
          <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '2px' }}>
            CLIENTE
          </div>
          <div>{sale.client.name}</div>
          {sale.client.cpfCnpj && (
            <div>CPF/CNPJ: {formatCPFCpf(sale.client.cpfCnpj)}</div>
          )}
          {sale.client.phone && <div>Tel: {formatPhone(sale.client.phone)}</div>}
        </div>
      )}

      {/* ===== ITEMS ===== */}
      <div>
        <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '4px' }}>
          ITENS
        </div>

        {sale.items.map((item, idx) => (
          <div key={`item-${idx}`} style={{ marginBottom: '4px' }}>
            <div style={{ wordBreak: 'break-word', overflowWrap: 'break-word' }}>{item.description}</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', whiteSpace: 'nowrap' }}>
              <span>
                {item.quantity} x {formatCurrency(item.unitPrice)}
              </span>
              <span style={{ fontWeight: 'bold' }}>
                {formatCurrency(item.totalPrice)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <DashedLine />

      {/* ===== SUBTOTAL + TOTALS ===== */}
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>Subtotal:</span>
        <span>{formatCurrency(sale.items.reduce((sum, i) => sum + i.totalPrice, 0))}</span>
      </div>
      {sale.discount > 0 && (
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Desconto:</span>
          <span>-{formatCurrency(sale.discount)}</span>
        </div>
      )}

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '16px',
          fontWeight: 'bold',
        }}
      >
        <span>TOTAL:</span>
        <span>{formatCurrency(sale.totalAmount)}</span>
      </div>

      {/* Payment info */}
      {isPaid && sale.paymentMethod && (
        <div style={{ marginTop: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Forma de Pagamento:</span>
            <span>{getPaymentMethodLabel(sale.paymentMethod)}</span>
          </div>
          {sale.paidAt && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Data do Pagamento:</span>
              <span>{formatDate(sale.paidAt)}</span>
            </div>
          )}
        </div>
      )}

      <DashedLine />

      {/* ===== THANK YOU ===== */}
      <div style={{ textAlign: 'center', padding: '8px 0' }}>
        <div style={{ fontWeight: 'bold', fontSize: '14px' }}>
          Obrigado pela preferência!
        </div>
        <div style={{ fontSize: '11px', color: '#555' }}>
          Volte sempre! Estamos à disposição.
        </div>
        <div style={{ fontSize: '10px', marginTop: '4px', color: '#777' }}>
          {office.name}
        </div>
      </div>

      <DashedLine />

      {/* ===== FOOTER ===== */}
      <div style={{ textAlign: 'center', fontSize: '10px', color: '#999' }}>
        <div>Documento não fiscal</div>
        <div style={{ marginTop: '2px', fontSize: '9px', color: '#bbb' }}>
          KiteOS - Sistema de Gestão para Oficinas
        </div>
      </div>
    </div>
  )
}

// =============================================
// MAIN COMPONENT
// =============================================
export function PdvReceipt({ sale, office, onClose }: PdvReceiptProps) {
  const receiptRef = useRef<HTMLDivElement>(null)
  const { office: authOffice } = useAuthStore()

  // WhatsApp state
  const [waEnabled, setWaEnabled] = useState(false)
  const [waSending, setWaSending] = useState(false)
  const [waMessage, setWaMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Check if WhatsApp is configured
  useEffect(() => {
    const checkWaConfig = async () => {
      const officeId = authOffice?.id
      if (!officeId) return
      try {
        const res = await apiFetch(`/api/whatsapp/config?officeId=${officeId}`)
        if (res.success && res.data) {
          setWaEnabled(res.data.enabled && res.data.configured && res.data.hasToken)
        }
      } catch {
        // Silently handle
      }
    }
    checkWaConfig()
  }, [authOffice?.id])

  const handleSendWhatsApp = useCallback(async () => {
    const officeId = authOffice?.id
    if (!officeId) return
    setWaSending(true)
    setWaMessage(null)
    try {
      const res = await apiFetch('/api/whatsapp/send-sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId,
          saleId: sale.id,
        }),
      })
      if (res.success) {
        const phone = res.data?.phone || sale.client?.phone || ''
        setWaMessage({
          type: 'success',
          text: `Recibo enviado via WhatsApp para ${phone}`,
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
  }, [authOffice?.id, sale.id, sale.client?.phone])

  const handlePrint = useCallback(() => {
    const content = receiptRef.current
    if (!content) return

    // Clone the HTML and fix relative image paths to absolute URLs
    const origin = window.location.origin
    const htmlContent = content.innerHTML
      .replace(/src="\/api\/uploads\//g, `src="${origin}/api/uploads/`)
      .replace(/src="\/uploads\//g, `src="${origin}/api/uploads/`)

    const printWindow = window.open('', '_blank', 'width=400,height=700')
    if (!printWindow) return

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${sale.number} - ${office.name}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }

            body {
              font-family: 'Courier New', Courier, monospace;
              display: flex;
              justify-content: center;
              background: #f5f5f5;
              padding: 20px;
            }

            @media print {
              body {
                background: #fff;
                padding: 0;
              }

              .no-print {
                display: none !important;
              }

              #pdv-receipt-content {
                max-width: 100%;
                width: 100%;
                box-shadow: none;
              }
            }

            @page {
              margin: 5mm;
              size: 80mm auto;
            }
          </style>
        </head>
        <body>
          <div class="no-print" style="text-align: center; margin-bottom: 16px; width: 302px;">
            <button
              onclick="window.print()"
              style="
                padding: 10px 24px;
                background: #059669;
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-family: sans-serif;
                margin-right: 8px;
              "
            >
              🖨️ Imprimir
            </button>
            <button
              onclick="window.close()"
              style="
                padding: 10px 24px;
                background: #6b7280;
                color: white;
                border: none;
                border-radius: 6px;
                cursor: pointer;
                font-size: 14px;
                font-family: sans-serif;
              "
            >
              ✕ Fechar
            </button>
          </div>
          ${htmlContent}
        </body>
      </html>
    `)

    printWindow.document.close()
  }, [sale.number, office.name])

  return (
    <div className="flex flex-col items-center">
      {/* WhatsApp feedback message */}
      {waMessage && (
        <div className={`print-hide mb-4 p-3 rounded-lg text-sm flex items-center gap-2 w-full max-w-md ${
          waMessage.type === 'success'
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {waMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {waMessage.text}
        </div>
      )}

      {/* Action buttons */}
      <div className="print-hide flex flex-wrap items-center justify-center gap-3 mb-6 w-full max-w-md">
        <Button
          onClick={handlePrint}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          <Printer className="w-4 h-4" />
          Imprimir
        </Button>
        {waEnabled && (
          <Button
            onClick={handleSendWhatsApp}
            disabled={waSending}
            className="bg-green-600 hover:bg-green-700 text-white gap-2"
          >
            {waSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageCircle className="w-4 h-4" />}
            Enviar WhatsApp
          </Button>
        )}
        {onClose && (
          <Button
            variant="outline"
            onClick={onClose}
            className="gap-2"
          >
            <X className="w-4 h-4" />
            Fechar
          </Button>
        )}
      </div>

      {/* Receipt preview with shadow to simulate paper */}
      <div
        ref={receiptRef}
        className="shadow-lg border border-zinc-200 rounded-sm"
        style={{
          maxWidth: '302px',
          width: '100%',
        }}
      >
        <ReceiptContent sale={sale} office={office} />
      </div>

      {/* Print-specific styles */}
      <style jsx global>{`
        @media print {
          .print-hide {
            display: none !important;
          }

          #pdv-receipt-content {
            max-width: 100% !important;
            width: 100% !important;
            box-shadow: none !important;
            border: none !important;
          }

          body {
            background: white !important;
          }

          @page {
            margin: 5mm;
            size: 80mm auto;
          }
        }
      `}</style>
    </div>
  )
}

export default PdvReceipt
