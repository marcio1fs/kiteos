'use client'

import { useRef, useCallback, useState, useEffect } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Printer, X, MessageCircle, Loader2, CheckCircle, AlertTriangle } from 'lucide-react'

// =============================================
// TYPES
// =============================================
interface OSReceiptProps {
  os: {
    id: string
    number: string
    status: string
    description?: string | null
    diagnosis?: string | null
    totalParts: number
    totalServices: number
    totalDiscount: number
    totalAmount: number
    paymentMethod?: string | null
    paidAt?: string | null
    createdAt: string
    client?: {
      name: string
      phone?: string | null
      email?: string | null
      cpfCnpj?: string | null
    } | null
    vehicle?: {
      plate: string
      brand?: string | null
      model?: string | null
      year?: number | null
      color?: string | null
    } | null
    items: {
      type: string
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
  mode?: 'receipt' | 'closure' // receipt = payment receipt, closure = OS closure
  onClose?: () => void
}

// =============================================
// FORMAT HELPERS
// =============================================
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(value)
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
  return digits.replace(
    /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
    '$1.$2.$3/$4-$5'
  )
}

function formatCPFCpf(cpfCnpj: string): string {
  const digits = cpfCnpj.replace(/\D/g, '')
  if (digits.length === 14) {
    return digits.replace(
      /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
      '$1.$2.$3/$4-$5'
    )
  }
  if (digits.length === 11) {
    return digits.replace(
      /^(\d{3})(\d{3})(\d{3})(\d{2})$/,
      '$1.$2.$3-$4'
    )
  }
  return cpfCnpj
}

function formatPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11) {
    return digits.replace(/^(\d{2})(\d{5})(\d{4})$/, '($1) $2-$3')
  }
  if (digits.length === 10) {
    return digits.replace(/^(\d{2})(\d{4})(\d{4})$/, '($1) $2-$3')
  }
  return phone
}

/**
 * Resolve logo URL for display.
 * Uses API route for serving uploaded files since Next.js standalone
 * doesn't serve dynamically added public files.
 */
function resolveLogoUrl(logo: string | null | undefined): string | null {
  if (!logo) return null
  if (logo.startsWith('http') || logo.startsWith('data:')) return logo
  // Convert /uploads/logos/filename.png → /api/uploads/logos/filename.png
  return logo.replace(/^\/uploads\//, '/api/uploads/')
}

function getPaymentMethodLabel(method: string): string {
  switch (method) {
    case 'PIX':
      return 'PIX'
    case 'CARTAO':
      return 'Cartão'
    case 'DINHEIRO':
      return 'Dinheiro'
    default:
      return method
  }
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
function ReceiptContent({ os, office, mode }: Omit<OSReceiptProps, 'onClose'>) {
  const serviceItems = os.items.filter((i) => i.type === 'SERVICO')
  const partItems = os.items.filter((i) => i.type === 'PECA')
  const isPaid = os.status === 'PAGA'
  const title =
    mode === 'closure'
      ? 'ORDEM DE SERVIÇO'
      : isPaid
      ? 'RECIBO DE PAGAMENTO'
      : 'ORDEM DE SERVIÇO'

  return (
    <div
      id="receipt-content"
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

      {/* ===== OS INFO ===== */}
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 'bold', fontSize: '14px', letterSpacing: '1px' }}>
          {title}
        </div>
      </div>

      <DashedLine />

      <div>
        <div>
          <strong>OS:</strong> {os.number}
        </div>
        <div>
          <strong>Data:</strong> {formatDate(os.createdAt)}
        </div>
        {os.diagnosis && (
          <div>
            <strong>Diagnóstico:</strong> {os.diagnosis}
          </div>
        )}
      </div>

      <DashedLine />

      {/* ===== CLIENT & VEHICLE ===== */}
      <div>
        <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '2px' }}>
          CLIENTE
        </div>
        <div>{os.client?.name || 'Cliente não informado'}</div>
        {os.client?.cpfCnpj && (
          <div>CPF/CNPJ: {formatCPFCpf(os.client.cpfCnpj)}</div>
        )}
        {os.client?.phone && <div>Tel: {formatPhone(os.client.phone)}</div>}
      </div>

      <div style={{ marginTop: '6px' }}>
        <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '2px' }}>
          VEÍCULO
        </div>
        <div>
          {os.vehicle ? [os.vehicle.brand, os.vehicle.model].filter(Boolean).join(' ') || 'N/A' : 'N/A'}
        </div>
        <div>
          Placa: {os.vehicle?.plate || '—'}
          {os.vehicle?.year ? ` | Ano: ${os.vehicle.year}` : ''}
          {os.vehicle?.color ? ` | Cor: ${os.vehicle.color}` : ''}
        </div>
      </div>

      <DashedLine />

      {/* ===== ITEMS TABLE ===== */}
      <div>
        <div style={{ fontWeight: 'bold', fontSize: '13px', marginBottom: '4px' }}>
          ITENS
        </div>

        {/* Services */}
        {serviceItems.length > 0 && (
          <div style={{ marginBottom: '6px' }}>
            <div style={{ fontWeight: 'bold', textDecoration: 'underline', fontSize: '11px' }}>
              SERVIÇOS
            </div>
            {serviceItems.map((item, idx) => (
              <div key={`svc-${idx}`} style={{ marginBottom: '2px' }}>
                <div>{item.description}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
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
        )}

        {/* Parts */}
        {partItems.length > 0 && (
          <div style={{ marginBottom: '6px' }}>
            <div style={{ fontWeight: 'bold', textDecoration: 'underline', fontSize: '11px' }}>
              PEÇAS
            </div>
            {partItems.map((item, idx) => (
              <div key={`ptc-${idx}`} style={{ marginBottom: '2px' }}>
                <div>{item.description}</div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
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
        )}
      </div>

      <DashedLine />

      {/* ===== TOTALS ===== */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Total Serviços:</span>
          <span>{formatCurrency(os.totalServices)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Total Peças:</span>
          <span>{formatCurrency(os.totalParts)}</span>
        </div>
        {os.totalDiscount > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Desconto:</span>
            <span>-{formatCurrency(os.totalDiscount)}</span>
          </div>
        )}
      </div>

      <DashedLine />

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: '16px',
          fontWeight: 'bold',
        }}
      >
        <span>TOTAL:</span>
        <span>{formatCurrency(os.totalAmount)}</span>
      </div>

      {/* Payment info */}
      {isPaid && os.paymentMethod && (
        <div style={{ marginTop: '6px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>Forma de Pagamento:</span>
            <span>{getPaymentMethodLabel(os.paymentMethod)}</span>
          </div>
          {os.paidAt && (
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Data do Pagamento:</span>
              <span>{formatDate(os.paidAt)}</span>
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
export function OSReceipt({ os, office, mode = 'receipt', onClose }: OSReceiptProps) {
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
      const res = await apiFetch('/api/whatsapp/send-os', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId,
          serviceOrderId: os.id,
          mode: mode === 'receipt' ? 'receipt' : 'estimate',
        }),
      })
      if (res.success) {
        const phone = res.data?.phone || os.client?.phone || ''
        setWaMessage({
          type: 'success',
          text: `${mode === 'receipt' ? 'Recibo' : 'Orçamento'} enviado via WhatsApp para ${phone}`,
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
  }, [authOffice?.id, os.id, os.client?.phone, mode])

  const handlePrint = useCallback(() => {
    const content = receiptRef.current
    if (!content) return

    // Clone the HTML and fix relative image paths to absolute URLs
    // Logo uses /api/uploads/ path, so fix both /api/uploads/ and /uploads/ patterns
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
          <title>${os.number} - ${office.name}</title>
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

              #receipt-content {
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
  }, [os.number, office.name])

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
        <ReceiptContent os={os} office={office} mode={mode} />
      </div>

      {/* Print-specific styles */}
      <style jsx global>{`
        @media print {
          .print-hide {
            display: none !important;
          }

          #receipt-content {
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

export default OSReceipt
