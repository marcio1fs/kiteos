/**
 * Shared print utilities for KiteOS reports.
 *
 * Usage:
 *   import { printReport } from '@/lib/print-utils'
 *   printReport({ title: 'Relatório Financeiro', contentHtml: '<table>...</table>' })
 */

interface PrintReportOptions {
  /** Title shown in the browser tab and at the top of the printed page */
  title: string
  /** Raw HTML content to render inside the print window */
  contentHtml: string
  /** Optional CSS to inject (in addition to the default styles) */
  extraCss?: string
  /** Whether to use A4 portrait (default) or thermal 80mm receipt mode */
  mode?: 'a4' | 'thermal'
}

/**
 * Opens a new browser window with the given content and triggers
 * the browser's native print dialog.
 */
export function printReport(options: PrintReportOptions) {
  const { title, contentHtml, extraCss = '', mode = 'a4' } = options

  const printWindow = window.open('', '_blank', 'width=900,height=700')
  if (!printWindow) {
    alert('Não foi possível abrir a janela de impressão. Verifique se o bloqueador de pop-ups está desativado.')
    return
  }

  const pageStyle =
    mode === 'thermal'
      ? `
        @page { margin: 5mm; size: 80mm auto; }
        body { max-width: 302px; margin: 0 auto; }
      `
      : `
        @page { margin: 15mm; size: A4 portrait; }
        body { max-width: 210mm; margin: 0 auto; }
      `

  printWindow.document.write(`
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8" />
        <title>${title}</title>
        <style>
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            font-size: 12px;
            line-height: 1.5;
            color: #1a1a1a;
            background: #f5f5f5;
            padding: 20px;
          }

          ${pageStyle}

          @media print {
            body {
              background: #fff;
              padding: 0;
            }
            .no-print {
              display: none !important;
            }
          }

          /* Print action buttons */
          .print-actions {
            text-align: center;
            margin-bottom: 20px;
            gap: 8px;
            display: flex;
            justify-content: center;
          }

          .print-actions button {
            padding: 10px 24px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-family: sans-serif;
            color: white;
          }

          .btn-print {
            background: #059669;
          }

          .btn-close {
            background: #6b7280;
          }

          /* Report content styling */
          .report-container {
            background: #fff;
            padding: 24px;
            border-radius: 8px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
          }

          .report-header {
            text-align: center;
            margin-bottom: 20px;
            padding-bottom: 16px;
            border-bottom: 2px solid #059669;
          }

          .report-header h1 {
            font-size: 18px;
            color: #059669;
            margin-bottom: 4px;
          }

          .report-header p {
            font-size: 11px;
            color: #666;
          }

          /* Table styling */
          table {
            width: 100%;
            border-collapse: collapse;
            margin: 12px 0;
            font-size: 11px;
          }

          table th {
            background: #f0fdf4;
            color: #065f46;
            padding: 8px 10px;
            text-align: left;
            border-bottom: 2px solid #059669;
            font-weight: 600;
            font-size: 10px;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }

          table td {
            padding: 6px 10px;
            border-bottom: 1px solid #e5e7eb;
          }

          table tr:nth-child(even) {
            background: #f9fafb;
          }

          table tr:hover {
            background: #f0fdf4;
          }

          .text-right {
            text-align: right;
          }

          .text-center {
            text-align: center;
          }

          .font-bold {
            font-weight: bold;
          }

          .text-red {
            color: #dc2626;
          }

          .text-green {
            color: #059669;
          }

          .text-blue {
            color: #2563eb;
          }

          .text-amber {
            color: #d97706;
          }

          /* Summary cards */
          .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 12px;
            margin: 16px 0;
          }

          .summary-card {
            padding: 12px;
            border-radius: 8px;
            text-align: center;
          }

          .summary-card.green {
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
          }

          .summary-card.red {
            background: #fef2f2;
            border: 1px solid #fecaca;
          }

          .summary-card.blue {
            background: #eff6ff;
            border: 1px solid #bfdbfe;
          }

          .summary-card.amber {
            background: #fffbeb;
            border: 1px solid #fde68a;
          }

          .summary-card .label {
            font-size: 10px;
            color: #666;
            margin-bottom: 4px;
          }

          .summary-card .value {
            font-size: 18px;
            font-weight: bold;
          }

          /* Footer */
          .report-footer {
            margin-top: 24px;
            padding-top: 12px;
            border-top: 1px solid #e5e7eb;
            text-align: center;
            font-size: 10px;
            color: #999;
          }

          /* Section headers */
          .section-title {
            font-size: 13px;
            font-weight: bold;
            color: #1a1a1a;
            margin: 16px 0 8px 0;
            padding-bottom: 4px;
            border-bottom: 1px solid #e5e7eb;
          }

          /* Mechanic card in commission report */
          .mechanic-card {
            border: 1px solid #e5e7eb;
            border-radius: 8px;
            padding: 12px;
            margin: 12px 0;
          }

          .mechanic-card .mechanic-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            padding-bottom: 8px;
            border-bottom: 1px dashed #d1d5db;
          }

          .mechanic-card .mechanic-name {
            font-size: 14px;
            font-weight: bold;
          }

          .mechanic-card .commission-value {
            font-size: 16px;
            font-weight: bold;
            color: #059669;
          }

          .mechanic-card .item-row {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            font-size: 11px;
            border-bottom: 1px dotted #f3f4f6;
          }

          .mechanic-card .item-desc {
            flex: 1;
          }

          .mechanic-card .item-values {
            text-align: right;
            white-space: nowrap;
          }

          /* Totals row */
          .totals-row {
            font-weight: bold;
            background: #f0fdf4 !important;
          }

          .totals-row td {
            border-top: 2px solid #059669;
            padding-top: 10px;
          }

          ${extraCss}
        </style>
      </head>
      <body>
        <div class="no-print print-actions">
          <button class="btn-print" onclick="window.print()">Imprimir</button>
          <button class="btn-close" onclick="window.close()">Fechar</button>
        </div>
        <div class="report-container">
          ${contentHtml}
          <div class="report-footer">
            Relatório gerado pelo KiteOS - Sistema de Gestão para Oficinas
          </div>
        </div>
      </body>
    </html>
  `)

  printWindow.document.close()
}

/**
 * Generates a standard report header with office info.
 */
export function buildReportHeader(title: string, officeName: string, subtitle?: string): string {
  const now = new Date().toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  return `
    <div class="report-header">
      <h1>${title}</h1>
      <p>${officeName}</p>
      ${subtitle ? `<p>${subtitle}</p>` : ''}
      <p>Gerado em: ${now}</p>
    </div>
  `
}

/**
 * Formats a number as BRL currency for print HTML.
 */
export function fmtCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

/**
 * Formats a date string for print HTML.
 */
export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('pt-BR')
}
