import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { safeExternalFetch } from '@/lib/safe-url';
import { decryptToken } from '@/lib/token-encryption';
import { assertFeature, isPlanError, planErrorBody } from '@/lib/plans';

/**
 * Format a phone number to international format for WhatsApp
 */
function formatWhatsAppPhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = digits.substring(1);
  if (!digits.startsWith('55') && digits.length >= 10) digits = '55' + digits;
  return digits;
}

/**
 * Sanitize the API URL
 */
function sanitizeApiUrl(url: string): string {
  let clean = url.trim().replace(/\/+$/, '');
  const zApiMatch = clean.match(/^(https?:\/\/[^\/]+)\/instances\//i);
  if (zApiMatch) return zApiMatch[1];
  const evoMatch = clean.match(/^(https?:\/\/[^\/]+)\/(message|instance|chat)\//i);
  if (evoMatch) return evoMatch[1];
  try {
    const parsed = new URL(clean);
    if (parsed.pathname.length > 1) {
      const apiBaseMatch = parsed.pathname.match(/^(\/(v\d+|api)(\/|$))/);
      if (apiBaseMatch) return `${parsed.origin}${apiBaseMatch[1].replace(/\/$/, '')}`;
      return parsed.origin;
    }
    return parsed.origin;
  } catch {
    return clean;
  }
}

/**
 * Extract instance from URL if user pasted the full URL
 */
function extractInstanceFromUrl(url: string, existingInstance: string | null): string | null {
  if (existingInstance) return existingInstance;
  const match = url.match(/\/instances\/([^\/]+)/i);
  return match ? match[1] : null;
}

/**
 * Extract token from URL if user pasted the full URL
 */
function extractTokenFromUrl(url: string, existingToken: string | null): string | null {
  if (existingToken) return existingToken;
  const match = url.match(/\/token\/([^\/]+)/i);
  return match ? match[1] : null;
}

/**
 * Format currency for WhatsApp message
 */
function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/**
 * Format date for WhatsApp message
 */
function formatDate(dateStr: string | Date): string {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Build NF message text for WhatsApp
 */
function buildNFMessage(
  invoice: {
    number: string;
    type: string;
    status: string;
    dataEmissao: string | Date;
    destNome: string;
    destCpfCnpj?: string | null;
    destTelefone?: string | null;
    veiculoPlaca?: string | null;
    veiculoModelo?: string | null;
    subtotal: number;
    desconto: number;
    totalAmount: number;
    baseIcms: number;
    valorIcms: number;
    observacao?: string | null;
    items: {
      tipo: string;
      descricao: string;
      quantidade: number;
      valorUnitario: number;
      valorTotal: number;
    }[];
    sale?: { number: string } | null;
    serviceOrder?: { number: string } | null;
  },
  office: { name: string; cnpj: string; phone?: string | null; address?: string | null; city?: string | null; state?: string | null }
): string {
  const isVenda = invoice.type === 'VENDA';
  const title = isVenda ? 'NOTA FISCAL DE VENDA' : 'NOTA FISCAL DE SERVIÇO';
  const isCancelled = invoice.status === 'CANCELADA';

  let msg = '';

  // Header
  msg += `*${office.name}*\n`;
  msg += `CNPJ: ${office.cnpj}\n`;
  if (office.address) msg += `${office.address}\n`;
  if (office.city || office.state) msg += `${[office.city, office.state].filter(Boolean).join(' - ')}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📋 *${title}*\n`;
  msg += `NF: *${invoice.number}*\n`;
  msg += `Data: ${formatDate(invoice.dataEmissao)}\n`;

  if (isCancelled) {
    msg += `\n❌ *CANCELADA*\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Source document reference
  if (invoice.sale) {
    msg += `📄 *Venda:* ${invoice.sale.number}\n`;
  }
  if (invoice.serviceOrder) {
    msg += `📄 *OS:* ${invoice.serviceOrder.number}\n`;
  }

  // Client
  msg += `\n👤 *Destinatário:* ${invoice.destNome}\n`;
  if (invoice.destCpfCnpj) {
    msg += `📄 CPF/CNPJ: ${invoice.destCpfCnpj}\n`;
  }

  // Vehicle (for service NF)
  if (!isVenda && (invoice.veiculoPlaca || invoice.veiculoModelo)) {
    msg += `\n🚗 *Veículo:* ${invoice.veiculoModelo || 'N/A'}\n`;
    if (invoice.veiculoPlaca) msg += `📌 *Placa:* ${invoice.veiculoPlaca}\n`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;

  // Items
  if (invoice.items.length > 0) {
    msg += `\n📌 *ITENS:*\n`;
    invoice.items.forEach((item, idx) => {
      const tipoLabel = item.tipo === 'PRODUTO' ? '🔩' : '🔧';
      msg += `${idx + 1}. ${tipoLabel} ${item.descricao}\n`;
      msg += `   ${item.quantidade}x ${formatCurrency(item.valorUnitario)} = *${formatCurrency(item.valorTotal)}*\n`;
    });
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;

  // Totals
  msg += `💰 *Subtotal:* ${formatCurrency(invoice.subtotal)}\n`;
  if (invoice.desconto > 0) {
    msg += `🏷️ *Desconto:* -${formatCurrency(invoice.desconto)}\n`;
  }
  msg += `\n💵 *TOTAL: ${formatCurrency(invoice.totalAmount)}*\n`;

  // Tax info (if any)
  if (invoice.baseIcms > 0 || invoice.valorIcms > 0) {
    msg += `\n📊 *Impostos:*\n`;
    if (invoice.baseIcms > 0) msg += `   Base ICMS: ${formatCurrency(invoice.baseIcms)}\n`;
    if (invoice.valorIcms > 0) msg += `   Valor ICMS: ${formatCurrency(invoice.valorIcms)}\n`;
  }

  // Observation
  if (invoice.observacao) {
    msg += `\n📝 *Obs:* ${invoice.observacao}\n`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Documento auxiliar - Não substitui NF-e/NFS-e oficial\n`;
  msg += `_Emitido por ${office.name}_\n`;
  if (office.phone) {
    msg += `📞 ${office.phone}\n`;
  }

  return msg;
}

/**
 * Send text message via Z-API
 */
async function sendViaZApi(
  apiUrl: string, instance: string, token: string, phone: string, message: string
): Promise<{ success: boolean; details: string }> {
  const baseUrl = apiUrl.replace(/\/$/, '');
  const url = `${baseUrl}/instances/${instance}/token/${token}/send-text`;

  const response = await safeExternalFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ phone, message }),
    timeoutMs: 15000,
  });

  if (response.ok) {
    const data = await response.json();
    return { success: true, details: `Enviado via Z-API: ${JSON.stringify(data)}` };
  } else {
    const errorText = await response.text().catch(() => 'Unknown error');
    return { success: false, details: `Z-API erro ${response.status}: ${errorText}` };
  }
}

/**
 * Send text message via Evolution API
 */
async function sendViaEvolutionApi(
  apiUrl: string, instance: string, token: string, phone: string, message: string
): Promise<{ success: boolean; details: string }> {
  const baseUrl = apiUrl.replace(/\/$/, '');
  const url = `${baseUrl}/message/sendText/${instance}`;

  const response = await safeExternalFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': token },
    body: JSON.stringify({ number: phone, text: message }),
    timeoutMs: 15000,
  });

  if (response.ok) {
    const data = await response.json();
    return { success: true, details: `Enviado via Evolution API: ${JSON.stringify(data)}` };
  } else {
    const errorText = await response.text().catch(() => 'Unknown error');
    return { success: false, details: `Evolution API erro ${response.status}: ${errorText}` };
  }
}

/**
 * Send via WhatsApp API - tries Z-API first, then Evolution API
 */
async function sendWhatsAppMessage(
  apiUrl: string, instance: string, token: string, phone: string, message: string
): Promise<{ success: boolean; details: string; method: string }> {
  const zApiResult = await sendViaZApi(apiUrl, instance, token, phone, message);
  if (zApiResult.success) return { ...zApiResult, method: 'Z-API' };

  const evoResult = await sendViaEvolutionApi(apiUrl, instance, token, phone, message);
  if (evoResult.success) return { ...evoResult, method: 'Evolution API' };

  return {
    success: false,
    details: `Falha ao enviar via Z-API e Evolution API. Z-API: ${zApiResult.details} | Evolution: ${evoResult.details}`,
    method: 'NONE',
  };
}

// POST /api/whatsapp/send-nf - Send client invoice (NF) via WhatsApp
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, clientInvoiceId, customPhone } = body;

    if (!officeId || !clientInvoiceId) {
      return NextResponse.json(
        { success: false, error: 'officeId e clientInvoiceId são obrigatórios' },
        { status: 400 }
      );
    }

    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    // WhatsApp delivery is a paid feature. Enforced server-side: hiding the button
    // in the UI is not authorization.
    try {
      await assertFeature(db, officeId, 'whatsapp');
    } catch (planError) {
      if (isPlanError(planError)) {
        return NextResponse.json(planErrorBody(planError).body, { status: planError.status });
      }
      throw planError;
    }

    // Get office with WhatsApp config
    const office = await db.office.findUnique({
      where: { id: officeId },
      select: {
        name: true,
        cnpj: true,
        phone: true,
        address: true,
        city: true,
        state: true,
        waEnabled: true,
        waApiUrl: true,
        waApiToken: true,
        waInstance: true,
        waPhone: true,
      },
    });

    if (!office) {
      return NextResponse.json(
        { success: false, error: 'Oficina não encontrada' },
        { status: 404 }
      );
    }

    if (!office.waEnabled || !office.waApiUrl || !office.waInstance) {
      return NextResponse.json(
        { success: false, error: 'WhatsApp não configurado. Configure a API do WhatsApp no perfil da oficina.' },
        { status: 400 }
      );
    }

    // Sanitize and extract WhatsApp config
    let waApiUrl = sanitizeApiUrl(office.waApiUrl);
    let waInstance = extractInstanceFromUrl(office.waApiUrl, office.waInstance);
    let waApiToken = decryptToken(office.waApiToken) || extractTokenFromUrl(office.waApiUrl, null);

    if (!waApiToken) {
      return NextResponse.json(
        { success: false, error: 'Token da API do WhatsApp não configurado.' },
        { status: 400 }
      );
    }

    // Get client invoice with all related data
    const invoice = await db.clientInvoice.findUnique({
      where: { id: clientInvoiceId },
      include: {
        items: {
          where: { deleted: false },
          select: {
            tipo: true,
            descricao: true,
            quantidade: true,
            valorUnitario: true,
            valorTotal: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        sale: { select: { number: true } },
        serviceOrder: { select: { number: true } },
        client: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!invoice || invoice.officeId !== officeId || invoice.deleted) {
      return NextResponse.json(
        { success: false, error: 'Nota fiscal não encontrada' },
        { status: 404 }
      );
    }

    // Determine recipient phone
    const recipientPhone = customPhone || invoice.destTelefone || invoice.client?.phone;
    if (!recipientPhone) {
      return NextResponse.json(
        { success: false, error: 'Cliente não possui telefone cadastrado. Informe um número de WhatsApp.' },
        { status: 400 }
      );
    }

    const formattedPhone = formatWhatsAppPhone(recipientPhone);
    const message = buildNFMessage(
      {
        number: invoice.number,
        type: invoice.type,
        status: invoice.status,
        dataEmissao: invoice.dataEmissao,
        destNome: invoice.destNome,
        destCpfCnpj: invoice.destCpfCnpj,
        destTelefone: invoice.destTelefone,
        veiculoPlaca: invoice.veiculoPlaca,
        veiculoModelo: invoice.veiculoModelo,
        subtotal: Number(invoice.subtotal),
        desconto: Number(invoice.desconto),
        totalAmount: Number(invoice.totalAmount),
        baseIcms: Number(invoice.baseIcms),
        valorIcms: Number(invoice.valorIcms),
        observacao: invoice.observacao,
        items: invoice.items.map(item => ({
          ...item,
          quantidade: Number(item.quantidade),
          valorUnitario: Number(item.valorUnitario),
          valorTotal: Number(item.valorTotal),
        })),
        sale: invoice.sale,
        serviceOrder: invoice.serviceOrder,
      },
      {
        name: office.name,
        cnpj: office.cnpj,
        phone: office.phone,
        address: office.address,
        city: office.city,
        state: office.state,
      }
    );

    // Send via WhatsApp API
    const sendResult = await sendWhatsAppMessage(
      waApiUrl,
      waInstance!,
      waApiToken!,
      formattedPhone,
      message
    );

    // Create notification record
    await db.notification.create({
      data: {
        type: 'WHATSAPP',
        template: 'CLIENT_INVOICE',
        title: `NF ${invoice.number} - ${invoice.type === 'VENDA' ? 'Venda' : 'Serviço'}`,
        message: message.substring(0, 500),
        recipient: formattedPhone,
        status: sendResult.success ? 'ENVIADA' : 'FALHOU',
        sentAt: sendResult.success ? new Date() : null,
        serviceOrderId: invoice.serviceOrderId || undefined,
        officeId,
      },
    });

    // Create audit log
    await createAuditLog({
      action: 'SEND_WHATSAPP',
      entity: 'ClientInvoice',
      entityId: invoice.id,
      details: JSON.stringify({
        type: 'CLIENT_INVOICE',
        invoiceType: invoice.type,
        phone: formattedPhone,
        success: sendResult.success,
        method: sendResult.method,
        invoiceNumber: invoice.number,
      }),
      userId: auth.payload.userId || null,
      officeId,
    });

    return NextResponse.json({
      success: sendResult.success,
      data: {
        sendResult,
        phone: formattedPhone,
        invoiceNumber: invoice.number,
      },
      error: sendResult.success ? undefined : sendResult.details,
    }, { status: sendResult.success ? 200 : 502 });

  } catch (error) {
    console.error('Error sending NF via WhatsApp:', error);
    return NextResponse.json(
      { success: false, error: 'Erro interno ao enviar nota fiscal via WhatsApp' },
      { status: 500 }
    );
  }
}
