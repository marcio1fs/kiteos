import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { decryptToken } from '@/lib/token-encryption';

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
 * Build sale receipt message text for WhatsApp
 */
function buildSaleMessage(
  sale: {
    number: string;
    status: string;
    discount: number;
    totalAmount: number;
    paymentMethod?: string | null;
    paidAt?: string | null;
    createdAt: string;
    client?: { name: string; phone?: string | null; cpfCnpj?: string | null } | null;
    items: { description: string; quantity: number; unitPrice: number; totalPrice: number }[];
  },
  office: { name: string; phone?: string | null }
): string {
  const isPaid = sale.status === 'PAGA';

  let msg = '';

  // Header
  msg += `*${office.name}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📋 *RECIBO DE VENDA*\n`;
  msg += `Venda: *${sale.number}*\n`;
  msg += `Data: ${formatDate(sale.createdAt)}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Client
  if (sale.client) {
    msg += `👤 *Cliente:* ${sale.client.name}\n`;
  }

  // Items
  if (sale.items.length > 0) {
    msg += `\n🔩 *ITENS:*\n`;
    sale.items.forEach((item, idx) => {
      msg += `${idx + 1}. ${item.description}\n`;
      msg += `   ${item.quantity}x ${formatCurrency(item.unitPrice)} = *${formatCurrency(item.totalPrice)}*\n`;
    });
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;

  // Totals
  if (sale.discount > 0) {
    msg += `🏷️ *Desconto:* -${formatCurrency(sale.discount)}\n`;
  }
  msg += `\n💵 *TOTAL: ${formatCurrency(sale.totalAmount)}*\n`;

  // Payment info
  if (isPaid && sale.paymentMethod) {
    const methodLabel = sale.paymentMethod === 'PIX' ? 'PIX' : sale.paymentMethod === 'CARTAO' ? 'Cartão' : sale.paymentMethod === 'DINHEIRO' ? 'Dinheiro' : sale.paymentMethod;
    msg += `\n✅ *PAGO* via ${methodLabel}`;
    if (sale.paidAt) msg += ` em ${formatDate(sale.paidAt)}`;
    msg += '\n';
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Obrigado pela preferência! 🙏\n`;
  if (office.phone) {
    msg += `📞 ${office.phone}\n`;
  }

  return msg;
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
 * Send text message via Z-API
 */
async function sendViaZApi(
  apiUrl: string, instance: string, token: string, phone: string, message: string
): Promise<{ success: boolean; details: string }> {
  const baseUrl = apiUrl.replace(/\/$/, '');
  const url = `${baseUrl}/instances/${instance}/token/${token}/send-text`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ phone, message }),
    signal: AbortSignal.timeout(15000),
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

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': token },
    body: JSON.stringify({ number: phone, text: message }),
    signal: AbortSignal.timeout(15000),
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

// POST /api/whatsapp/send-sale - Send sale receipt via WhatsApp
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, saleId, customPhone } = body;

    if (!officeId || !saleId) {
      return NextResponse.json(
        { success: false, error: 'officeId e saleId são obrigatórios' },
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

    // Get office with WhatsApp config
    const office = await db.office.findUnique({
      where: { id: officeId },
      select: {
        name: true,
        phone: true,
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

    // Sanitize WhatsApp config
    const waApiUrl = sanitizeApiUrl(office.waApiUrl);
    const waApiToken = decryptToken(office.waApiToken);
    const waInstance = office.waInstance;

    if (!waApiToken) {
      return NextResponse.json(
        { success: false, error: 'Token da API do WhatsApp não configurado.' },
        { status: 400 }
      );
    }

    // Get sale with all related data
    const sale = await db.sale.findUnique({
      where: { id: saleId },
      include: {
        client: {
          select: { id: true, name: true, phone: true, cpfCnpj: true },
        },
        items: {
          select: {
            description: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!sale || sale.officeId !== officeId) {
      return NextResponse.json(
        { success: false, error: 'Venda não encontrada' },
        { status: 404 }
      );
    }

    // Determine recipient phone
    const recipientPhone = customPhone || sale.client?.phone;
    if (!recipientPhone) {
      return NextResponse.json(
        { success: false, error: 'Cliente não possui telefone cadastrado. Informe um número de WhatsApp.' },
        { status: 400 }
      );
    }

    const formattedPhone = formatWhatsAppPhone(recipientPhone);
    const message = buildSaleMessage(
      {
        number: sale.number,
        status: sale.status,
        discount: Number(sale.discount),
        totalAmount: Number(sale.totalAmount),
        paymentMethod: sale.paymentMethod,
        paidAt: sale.paidAt?.toISOString(),
        createdAt: sale.createdAt.toISOString(),
        client: sale.client ? { name: sale.client.name, phone: sale.client.phone, cpfCnpj: sale.client.cpfCnpj } : null,
        items: sale.items.map(item => ({
          ...item,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
        })),
      },
      { name: office.name, phone: office.phone }
    );

    // Send via WhatsApp API
    const sendResult = await sendWhatsAppMessage(waApiUrl, waInstance, waApiToken, formattedPhone, message);

    // Create audit log
    await createAuditLog({
      action: 'SEND_WHATSAPP',
      entity: 'Sale',
      entityId: sale.id,
      details: JSON.stringify({
        type: 'SALE_RECEIPT',
        phone: formattedPhone,
        success: sendResult.success,
        method: sendResult.method,
        saleNumber: sale.number,
      }),
      userId: auth.payload.userId || null,
      officeId,
    });

    return NextResponse.json({
      success: sendResult.success,
      data: {
        sendResult,
        phone: formattedPhone,
        saleNumber: sale.number,
      },
      error: sendResult.success ? undefined : sendResult.details,
    }, { status: sendResult.success ? 200 : 502 });

  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    return NextResponse.json(
      { success: false, error: 'Erro interno ao enviar mensagem via WhatsApp' },
      { status: 500 }
    );
  }
}
