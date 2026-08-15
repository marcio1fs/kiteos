'use client'

import { useRef, useCallback, useState, useEffect } from 'react'
import { useAuthStore, apiFetch } from '@/lib/store'
import { Button } from '@/components/ui/button'
import { Printer, X, MessageCircle, Loader2, CheckCircle, AlertTriangle } from 'lucide-react'

// =============================================
// TYPES
// =============================================
interface ClientInvoiceItem {
  id: string
  tipo: string
  descricao: string
  quantidade: number
  unidade: string
  valorUnitario: number
  valorTotal: number
  ncm: string | null
  cfop: string | null
  cst: string | null
  csosn: string | null
  baseIcms: number
  valorIcms: number
  valorIpi: number
  valorPis: number
  valorCofins: number
}

export interface ClientInvoiceData {
  id: string
  number: string
  chave?: string | null
  serie?: string | null
  type: string
  status: string
  dataEmissao: string
  dataCancelamento: string | null
  destNome: string
  destCpfCnpj: string | null
  destEndereco: string | null
  destCidade: string | null
  destEstado: string | null
  destCep: string | null
  destTelefone: string | null
  destEmail: string | null
  veiculoPlaca: string | null
  veiculoModelo: string | null
  veiculoAno: number | null
  veiculoCor: string | null
  subtotal: number
  desconto: number
  totalAmount: number
  baseIcms: number
  valorIcms: number
  valorIpi: number
  valorPis: number
  valorCofins: number
  observacao: string | null
  motivoCancelamento: string | null
  saleId: string | null
  serviceOrderId: string | null
  sale: { id: string; number: string } | null
  serviceOrder: { id: string; number: string } | null
  client: { id: string; name: string; cpfCnpj: string | null } | null
  items: ClientInvoiceItem[]
  office: {
    id: string
    name: string
    cnpj: string
    email: string
    phone: string | null
    address: string | null
    city: string | null
    state: string | null
    zipCode: string | null
    logo: string | null
  }
}

interface ClientInvoiceDocProps {
  invoice: ClientInvoiceData
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

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatCNPJ(cnpj: string): string {
  const digits = cnpj.replace(/\D/g, '')
  if (digits.length !== 14) return cnpj
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5')
}

function formatCPFCnpj(cpfCnpj: string): string {
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

function resolveLogoUrl(logo: string | null | undefined): string | null {
  if (!logo) return null
  if (logo.startsWith('http') || logo.startsWith('data:')) return logo
  return logo.replace(/^\/uploads\//, '/api/uploads/')
}

// =============================================
// DOCUMENT CONTENT (used for both display and print)
// =============================================
function InvoiceDocumentContent({ invoice }: { invoice: ClientInvoiceData }) {
  const office = invoice.office
  const isVenda = invoice.type === 'VENDA'
  const isCancelled = invoice.status === 'CANCELADA'
  const title = isVenda ? 'NOTA FISCAL DE VENDA' : 'NOTA FISCAL DE SERVIÇO'
  const sourceDoc = isVenda ? invoice.sale : invoice.serviceOrder

  const tableHeaderStyle: React.CSSProperties = {
    background: '#1a1a2e',
    color: '#fff',
    fontWeight: 600,
    fontSize: '10px',
    padding: '8px 6px',
    textAlign: 'center',
    borderBottom: '2px solid #1a1a2e',
  }

  const tableCellStyle: React.CSSProperties = {
    padding: '6px',
    fontSize: '10px',
    borderBottom: '1px solid #e5e7eb',
    verticalAlign: 'middle',
  }

  const hasAnyTax = invoice.items.some(i => i.baseIcms > 0 || i.valorIcms > 0 || i.valorIpi > 0)

  return (
    <div
      id="client-invoice-content"
      style={{
        fontFamily: "'Segoe UI', 'Helvetica Neue', Arial, sans-serif",
        fontSize: '11px',
        lineHeight: '1.5',
        color: '#1a1a2e',
        maxWidth: '794px',
        width: '100%',
        margin: '0 auto',
        padding: '24px',
        background: '#fff',
      }}
    >
      {/* ===== CANCELLED WATERMARK ===== */}
      {isCancelled && (
        <div style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%) rotate(-30deg)',
          fontSize: '72px',
          fontWeight: 900,
          color: 'rgba(220, 38, 38, 0.15)',
          letterSpacing: '8px',
          pointerEvents: 'none',
          zIndex: 0,
        }}>
          CANCELADA
        </div>
      )}

      {/* ===== HEADER ===== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px', position: 'relative', zIndex: 1 }}>
        {office.logo && (
          <div style={{ flexShrink: 0 }}>
            <img
              src={resolveLogoUrl(office.logo) || undefined}
              alt={office.name}
              style={{ maxHeight: '80px', maxWidth: '160px', objectFit: 'contain' }}
            />
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: '18px', letterSpacing: '1px', color: '#1a1a2e' }}>
            {office.name}
          </div>
          <div style={{ fontSize: '11px', color: '#555' }}>
            <div>CNPJ: {formatCNPJ(office.cnpj)}</div>
            {office.address && <div>{office.address}</div>}
            {(office.city || office.state) && (
              <div>{[office.city, office.state].filter(Boolean).join(' - ')}{office.zipCode ? ` · CEP: ${office.zipCode}` : ''}</div>
            )}
            {office.phone && <div>Tel: {formatPhone(office.phone)}</div>}
            {office.email && <div>{office.email}</div>}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{
            background: isCancelled ? '#dc2626' : '#1a1a2e',
            color: '#fff',
            padding: '8px 16px',
            borderRadius: '4px',
            fontSize: '14px',
            fontWeight: 700,
            letterSpacing: '1px',
            marginBottom: '4px',
          }}>
            {title}
          </div>
          <div style={{ fontSize: '11px', color: '#555' }}>
            <div><strong>Nº:</strong> {invoice.number}</div>
            <div><strong>Data Emissão:</strong> {formatDateTime(invoice.dataEmissao)}</div>
            {isCancelled && invoice.dataCancelamento && (
              <div style={{ color: '#dc2626' }}><strong>Cancelada em:</strong> {formatDateTime(invoice.dataCancelamento)}</div>
            )}
          </div>
        </div>
      </div>

      {/* Separator */}
      <div style={{ borderBottom: '2px solid #1a1a2e', marginBottom: '12px' }} />

      {/* ===== CHAVE DE ACESSO ===== */}
      {invoice.chave && (
        <div style={{
          border: '1px solid #d1d5db',
          background: '#f9fafb',
          borderRadius: '4px',
          padding: '6px 12px',
          marginBottom: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: '11px',
        }}>
          <div><strong>CHAVE DE ACESSO:</strong></div>
          <div style={{ fontFamily: 'monospace', fontWeight: 700, letterSpacing: '1px', fontSize: '12px', color: '#1a1a2e' }}>
            {invoice.chave.replace(/(\d{4})/g, '$1 ').trim()}
          </div>
        </div>
      )}

      {/* ===== DESTINATÁRIO ===== */}
      <div style={{ border: '1px solid #d1d5db', borderRadius: '4px', padding: '10px 12px', marginBottom: '12px', position: 'relative', zIndex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '12px', color: '#1a1a2e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Destinatário / Remetente
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px 16px', fontSize: '11px' }}>
          <div style={{ gridColumn: '1 / 3' }}>
            <span style={{ color: '#888' }}>Nome/Razão Social: </span>
            <strong>{invoice.destNome}</strong>
          </div>
          <div>
            <span style={{ color: '#888' }}>CPF/CNPJ: </span>
            <strong>{invoice.destCpfCnpj ? formatCPFCnpj(invoice.destCpfCnpj) : '—'}</strong>
          </div>
          <div>
            <span style={{ color: '#888' }}>Endereço: </span>
            <strong>{invoice.destEndereco || '—'}</strong>
          </div>
          <div>
            <span style={{ color: '#888' }}>Cidade: </span>
            <strong>{invoice.destCidade || '—'}</strong>
          </div>
          <div>
            <span style={{ color: '#888' }}>UF: </span>
            <strong>{invoice.destEstado || '—'}</strong>
          </div>
          {invoice.destCep && (
            <div>
              <span style={{ color: '#888' }}>CEP: </span>
              <strong>{invoice.destCep}</strong>
            </div>
          )}
          {invoice.destTelefone && (
            <div>
              <span style={{ color: '#888' }}>Telefone: </span>
              <strong>{formatPhone(invoice.destTelefone)}</strong>
            </div>
          )}
          {invoice.destEmail && (
            <div>
              <span style={{ color: '#888' }}>Email: </span>
              <strong>{invoice.destEmail}</strong>
            </div>
          )}
        </div>
      </div>

      {/* ===== VEÍCULO (SERVICO only) ===== */}
      {!isVenda && (invoice.veiculoPlaca || invoice.veiculoModelo) && (
        <div style={{ border: '1px solid #d1d5db', borderRadius: '4px', padding: '10px 12px', marginBottom: '12px', position: 'relative', zIndex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '12px', color: '#1a1a2e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Veículo
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '4px 16px', fontSize: '11px' }}>
            <div>
              <span style={{ color: '#888' }}>Placa: </span>
              <strong>{invoice.veiculoPlaca || '—'}</strong>
            </div>
            <div>
              <span style={{ color: '#888' }}>Modelo: </span>
              <strong>{invoice.veiculoModelo || '—'}</strong>
            </div>
            <div>
              <span style={{ color: '#888' }}>Ano: </span>
              <strong>{invoice.veiculoAno || '—'}</strong>
            </div>
            <div>
              <span style={{ color: '#888' }}>Cor: </span>
              <strong>{invoice.veiculoCor || '—'}</strong>
            </div>
          </div>
        </div>
      )}

      {/* ===== ITEMS TABLE ===== */}
      <div style={{ border: '1px solid #d1d5db', borderRadius: '4px', overflow: 'hidden', marginBottom: '12px', position: 'relative', zIndex: 1 }}>
        <div style={{ fontWeight: 700, fontSize: '12px', color: '#fff', background: '#1a1a2e', padding: '6px 12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          {isVenda ? 'Produtos' : 'Itens da Nota Fiscal'}
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ ...tableHeaderStyle, width: '24px' }}>#</th>
              <th style={{ ...tableHeaderStyle, textAlign: 'left', width: isVenda ? 'auto' : 'auto' }}>Descrição</th>
              <th style={{ ...tableHeaderStyle, width: '60px' }}>NCM</th>
              <th style={{ ...tableHeaderStyle, width: '52px' }}>CFOP</th>
              <th style={{ ...tableHeaderStyle, width: '44px' }}>Qtd</th>
              <th style={{ ...tableHeaderStyle, width: '32px' }}>Un</th>
              <th style={{ ...tableHeaderStyle, width: '72px' }}>V. Unit.</th>
              <th style={{ ...tableHeaderStyle, width: '80px' }}>V. Total</th>
              {hasAnyTax && (
                <>
                  <th style={{ ...tableHeaderStyle, width: '52px' }}>ICMS</th>
                  <th style={{ ...tableHeaderStyle, width: '52px' }}>IPI</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {invoice.items.map((item, idx) => (
              <tr key={item.id} style={{ background: idx % 2 === 0 ? '#fff' : '#f9fafb' }}>
                <td style={{ ...tableCellStyle, textAlign: 'center' }}>{idx + 1}</td>
                <td style={{ ...tableCellStyle, textAlign: 'left', fontWeight: 500 }}>
                  {item.descricao}
                  {!isVenda && item.tipo === 'SERVICO' && (
                    <span style={{ fontSize: '9px', color: '#059669', marginLeft: '4px', fontWeight: 600 }}>(SERVIÇO)</span>
                  )}
                </td>
                <td style={{ ...tableCellStyle, textAlign: 'center', fontFamily: 'monospace' }}>{item.ncm || '—'}</td>
                <td style={{ ...tableCellStyle, textAlign: 'center', fontFamily: 'monospace' }}>{item.cfop || '—'}</td>
                <td style={{ ...tableCellStyle, textAlign: 'center' }}>{item.quantidade}</td>
                <td style={{ ...tableCellStyle, textAlign: 'center' }}>{item.unidade}</td>
                <td style={{ ...tableCellStyle, textAlign: 'right' }}>{formatCurrency(item.valorUnitario)}</td>
                <td style={{ ...tableCellStyle, textAlign: 'right', fontWeight: 600 }}>{formatCurrency(item.valorTotal)}</td>
                {hasAnyTax && (
                  <>
                    <td style={{ ...tableCellStyle, textAlign: 'right' }}>{item.valorIcms > 0 ? formatCurrency(item.valorIcms) : '—'}</td>
                    <td style={{ ...tableCellStyle, textAlign: 'right' }}>{item.valorIpi > 0 ? formatCurrency(item.valorIpi) : '—'}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ===== TAX SUMMARY & TOTALS ===== */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', position: 'relative', zIndex: 1 }}>
        {/* Tax Summary */}
        <div style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: '4px', padding: '10px 12px' }}>
          <div style={{ fontWeight: 700, fontSize: '12px', color: '#1a1a2e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Cálculo do Imposto
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px', fontSize: '11px' }}>
            <div>
              <span style={{ color: '#888' }}>Base ICMS: </span>
              <strong>{formatCurrency(invoice.baseIcms)}</strong>
            </div>
            <div>
              <span style={{ color: '#888' }}>Valor ICMS: </span>
              <strong>{formatCurrency(invoice.valorIcms)}</strong>
            </div>
            <div>
              <span style={{ color: '#888' }}>Valor IPI: </span>
              <strong>{formatCurrency(invoice.valorIpi)}</strong>
            </div>
            <div>
              <span style={{ color: '#888' }}>Valor PIS: </span>
              <strong>{formatCurrency(invoice.valorPis)}</strong>
            </div>
            <div>
              <span style={{ color: '#888' }}>Valor COFINS: </span>
              <strong>{formatCurrency(invoice.valorCofins)}</strong>
            </div>
          </div>
        </div>

        {/* Totals */}
        <div style={{ width: '240px', border: '1px solid #d1d5db', borderRadius: '4px', padding: '10px 12px' }}>
          <div style={{ fontWeight: 700, fontSize: '12px', color: '#1a1a2e', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Totais
          </div>
          <div style={{ fontSize: '11px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
              <span style={{ color: '#888' }}>Subtotal:</span>
              <span>{formatCurrency(invoice.subtotal)}</span>
            </div>
            {invoice.desconto > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span style={{ color: '#888' }}>Desconto:</span>
                <span style={{ color: '#dc2626' }}>-{formatCurrency(invoice.desconto)}</span>
              </div>
            )}
            <div style={{ borderBottom: '1px solid #e5e7eb', margin: '4px 0' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: 700 }}>
              <span>Total:</span>
              <span style={{ color: isCancelled ? '#dc2626' : '#059669' }}>{formatCurrency(invoice.totalAmount)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ===== SOURCE DOCUMENT ===== */}
      {sourceDoc && (
        <div style={{ fontSize: '11px', marginBottom: '8px', color: '#555', position: 'relative', zIndex: 1 }}>
          <span style={{ color: '#888' }}>Documento de origem: </span>
          <strong>{isVenda ? 'Venda' : 'OS'} {sourceDoc.number}</strong>
        </div>
      )}

      {/* ===== OBSERVATION ===== */}
      {invoice.observacao && (
        <div style={{ border: '1px solid #d1d5db', borderRadius: '4px', padding: '10px 12px', marginBottom: '12px', position: 'relative', zIndex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '12px', color: '#1a1a2e', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Observação
          </div>
          <div style={{ fontSize: '11px', color: '#555' }}>{invoice.observacao}</div>
        </div>
      )}

      {/* ===== CANCELLATION INFO ===== */}
      {isCancelled && invoice.motivoCancelamento && (
        <div style={{ border: '1px solid #fca5a5', borderRadius: '4px', padding: '10px 12px', marginBottom: '12px', background: '#fef2f2', position: 'relative', zIndex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '12px', color: '#dc2626', marginBottom: '4px' }}>
            Motivo do Cancelamento
          </div>
          <div style={{ fontSize: '11px', color: '#991b1b' }}>{invoice.motivoCancelamento}</div>
        </div>
      )}

      {/* ===== FOOTER ===== */}
      <div style={{ borderBottom: '1px solid #d1d5db', margin: '16px 0 8px' }} />
      <div style={{ textAlign: 'center', fontSize: '9px', color: '#999', position: 'relative', zIndex: 1 }}>
        <div>Documento auxiliar — Este documento não substitui a NF-e/NFS-e oficial emitida através da SEFAZ/Portal da Prefeitura</div>
        <div style={{ marginTop: '2px', fontSize: '8px', color: '#bbb' }}>
          KiteOS — Sistema de Gestão para Oficinas
        </div>
      </div>
    </div>
  )
}

// =============================================
// MAIN COMPONENT
// =============================================
export function ClientInvoiceDoc({ invoice, onClose }: ClientInvoiceDocProps) {
  const docRef = useRef<HTMLDivElement>(null)
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
      // Build a simple text message for WhatsApp
      const isVenda = invoice.type === 'VENDA'
      const title = isVenda ? 'Nota Fiscal de Venda' : 'Nota Fiscal de Serviço'
      let msg = `📋 *${title}* - ${invoice.number}\n`
      msg += `📅 Data: ${formatDate(invoice.dataEmissao)}\n`
      msg += `👤 Cliente: ${invoice.destNome}\n`
      if (invoice.destCpfCnpj) msg += `📄 CPF/CNPJ: ${formatCPFCnpj(invoice.destCpfCnpj)}\n`
      msg += `\n📌 *Itens:*\n`
      invoice.items.forEach((item, idx) => {
        msg += `${idx + 1}. ${item.descricao} - ${item.quantidade}x ${formatCurrency(item.valorUnitario)} = ${formatCurrency(item.valorTotal)}\n`
      })
      msg += `\n💰 *Total: ${formatCurrency(invoice.totalAmount)}*`
      if (invoice.desconto > 0) msg += ` (Desc: -${formatCurrency(invoice.desconto)})`
      msg += `\n\n_Emitido por ${invoice.office.name}_`

      const phone = invoice.destTelefone
      if (!phone) {
        setWaMessage({ type: 'error', text: 'Cliente não possui telefone cadastrado' })
        return
      }

      const res = await apiFetch('/api/whatsapp/send-nf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          officeId,
          clientInvoiceId: invoice.id,
          customPhone: phone,
        }),
      })
      if (res.success) {
        setWaMessage({
          type: 'success',
          text: `Nota fiscal enviada via WhatsApp para ${phone}`,
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
  }, [authOffice?.id, invoice])

  const handlePrint = useCallback(() => {
    const content = docRef.current
    if (!content) return

    const origin = window.location.origin
    const htmlContent = content.innerHTML
      .replace(/src="\/api\/uploads\//g, `src="${origin}/api/uploads/`)
      .replace(/src="\/uploads\//g, `src="${origin}/api/uploads/`)

    const printWindow = window.open('', '_blank', 'width=900,height=700')
    if (!printWindow) return

    const title = invoice.type === 'VENDA' ? 'Nota Fiscal de Venda' : 'Nota Fiscal de Serviço'

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${title} ${invoice.number} - ${invoice.office.name}</title>
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }

            body {
              font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
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

              #client-invoice-content {
                max-width: 100%;
                width: 100%;
                box-shadow: none;
              }
            }

            @page {
              margin: 10mm;
              size: A4 portrait;
            }
          </style>
        </head>
        <body>
          <div class="no-print" style="text-align: center; margin-bottom: 16px; width: 794px;">
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
  }, [invoice])

  return (
    <div className="flex flex-col items-center">
      {/* WhatsApp feedback message */}
      {waMessage && (
        <div className={`mb-4 p-3 rounded-lg text-sm flex items-center gap-2 w-full max-w-2xl ${
          waMessage.type === 'success'
            ? 'bg-emerald-50 border border-emerald-200 text-emerald-700'
            : 'bg-red-50 border border-red-200 text-red-700'
        }`}>
          {waMessage.type === 'success' ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {waMessage.text}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap items-center justify-center gap-3 mb-6 w-full max-w-2xl">
        <Button
          onClick={handlePrint}
          className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2"
        >
          <Printer className="w-4 h-4" />
          Imprimir
        </Button>
        {waEnabled && invoice.destTelefone && (
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

      {/* Invoice preview with shadow to simulate paper */}
      <div
        ref={docRef}
        className="shadow-lg border border-zinc-200 rounded-sm bg-white"
        style={{ maxWidth: '794px', width: '100%' }}
      >
        <InvoiceDocumentContent invoice={invoice} />
      </div>

      {/* Print-specific styles */}
      <style jsx global>{`
        @media print {
          .print-hide {
            display: none !important;
          }

          #client-invoice-content {
            max-width: 100% !important;
            width: 100% !important;
            box-shadow: none !important;
            border: none !important;
          }

          body {
            background: white !important;
          }

          @page {
            margin: 10mm;
            size: A4 portrait;
          }
        }
      `}</style>
    </div>
  )
}

export default ClientInvoiceDoc
