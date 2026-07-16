import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { createAuditLog } from '@/lib/audit';
import { decryptToken } from '@/lib/token-encryption';

/**
 * Format a phone number to international format for WhatsApp
 * Brazilian numbers: remove non-digits, ensure country code 55
 */
function formatWhatsAppPhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');

  // If starts with 0, remove it
  if (digits.startsWith('0')) {
    digits = digits.substring(1);
  }

  // If doesn't start with country code, add 55 (Brazil)
  if (!digits.startsWith('55') && digits.length >= 10) {
    digits = '55' + digits;
  }

  return digits;
}

/**
 * Sanitize the API URL - users often paste the full endpoint URL
 * instead of just the base URL. This function extracts the base URL.
 * Examples:
 *   "https://api.z-api.io/instances/XXX/token/YYY/send-text" → "https://api.z-api.io"
 *   "http://localhost:8080/message/sendText/instance" → "http://localhost:8080"
 *   "https://api.z-api.io" → "https://api.z-api.io" (unchanged)
 */
function sanitizeApiUrl(url: string): string {
  let clean = url.trim().replace(/\/+$/, '');

  // Detect Z-API pattern: /instances/... (remove everything from /instances/ onward)
  const zApiMatch = clean.match(/^(https?:\/\/[^\/]+)\/instances\//i);
  if (zApiMatch) {
    return zApiMatch[1];
  }

  // Detect Evolution API pattern: /message/sendText/... or /instance/...
  const evoMatch = clean.match(/^(https?:\/\/[^\/]+)\/(message|instance|chat)\//i);
  if (evoMatch) {
    return evoMatch[1];
  }

  // If URL has more than just domain + port, try to extract just the origin
  try {
    const parsed = new URL(clean);
    // If pathname has something meaningful, check if it looks like an API path
    if (parsed.pathname.length > 1) {
      // Common API base paths like /v1, /v2, /api are OK to keep
      const apiBaseMatch = parsed.pathname.match(/^(\/(v\d+|api)(\/|$))/);
      if (apiBaseMatch) {
        return `${parsed.origin}${apiBaseMatch[1].replace(/\/$/, '')}`;
      }
      // Otherwise, just use the origin
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
 * Build estimate/receipt message text for WhatsApp
 */
function buildOSMessage(
  os: {
    number: string;
    status: string;
    description?: string | null;
    diagnosis?: string | null;
    totalParts: number;
    totalServices: number;
    totalDiscount: number;
    totalAmount: number;
    paymentMethod?: string | null;
    paidAt?: string | null;
    createdAt: string;
    client: { name: string; phone?: string | null };
    vehicle: { plate: string; brand?: string | null; model?: string | null; year?: number | null; color?: string | null };
    items: { type: string; description: string; quantity: number; unitPrice: number; totalPrice: number }[];
  },
  office: { name: string; phone?: string | null },
  mode: 'estimate' | 'receipt'
): string {
  const isPaid = os.status === 'PAGA';
  const title = mode === 'estimate'
    ? 'ORÇAMENTO'
    : isPaid
    ? 'RECIBO DE PAGAMENTO'
    : 'ORDEM DE SERVIÇO';

  const serviceItems = os.items.filter(i => i.type === 'SERVICO');
  const partItems = os.items.filter(i => i.type === 'PECA');

  let msg = '';

  // Header
  msg += `*${office.name}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📋 *${title}*\n`;
  msg += `OS: *${os.number}*\n`;
  msg += `Data: ${formatDate(os.createdAt)}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n\n`;

  // Client & Vehicle
  msg += `👤 *Cliente:* ${os.client.name}\n`;
  if (os.vehicle) {
    const vehicleDesc = [os.vehicle.brand, os.vehicle.model].filter(Boolean).join(' ') || 'N/A';
    msg += `🚗 *Veículo:* ${vehicleDesc}\n`;
    msg += `📌 *Placa:* ${os.vehicle.plate}`;
    if (os.vehicle.year) msg += ` | Ano: ${os.vehicle.year}`;
    if (os.vehicle.color) msg += ` | Cor: ${os.vehicle.color}`;
    msg += '\n';
  }

  // Description/Diagnosis
  if (os.description) {
    msg += `\n📝 *Descrição:* ${os.description}\n`;
  }
  if (os.diagnosis) {
    msg += `🔍 *Diagnóstico:* ${os.diagnosis}\n`;
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;

  // Services
  if (serviceItems.length > 0) {
    msg += `\n🔧 *SERVIÇOS:*\n`;
    serviceItems.forEach((item, idx) => {
      msg += `${idx + 1}. ${item.description}\n`;
      msg += `   ${item.quantity}x ${formatCurrency(item.unitPrice)} = *${formatCurrency(item.totalPrice)}*\n`;
    });
  }

  // Parts
  if (partItems.length > 0) {
    msg += `\n🔩 *PEÇAS:*\n`;
    partItems.forEach((item, idx) => {
      msg += `${idx + 1}. ${item.description}\n`;
      msg += `   ${item.quantity}x ${formatCurrency(item.unitPrice)} = *${formatCurrency(item.totalPrice)}*\n`;
    });
  }

  msg += `\n━━━━━━━━━━━━━━━━━━━━\n`;

  // Totals
  msg += `💰 *Total Serviços:* ${formatCurrency(os.totalServices)}\n`;
  msg += `🔧 *Total Peças:* ${formatCurrency(os.totalParts)}\n`;
  if (os.totalDiscount > 0) {
    msg += `🏷️ *Desconto:* -${formatCurrency(os.totalDiscount)}\n`;
  }
  msg += `\n💵 *TOTAL: ${formatCurrency(os.totalAmount)}*\n`;

  // Payment info (for receipt)
  if (mode === 'receipt' && isPaid && os.paymentMethod) {
    const methodLabel = os.paymentMethod === 'PIX' ? 'PIX' : os.paymentMethod === 'CARTAO' ? 'Cartão' : os.paymentMethod === 'DINHEIRO' ? 'Dinheiro' : os.paymentMethod;
    msg += `\n✅ *PAGO* via ${methodLabel}`;
    if (os.paidAt) msg += ` em ${formatDate(os.paidAt)}`;
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
 * Send text message via Z-API
 */
async function sendViaZApi(
  apiUrl: string,
  instance: string,
  token: string,
  phone: string,
  message: string
): Promise<{ success: boolean; details: string }> {
  const baseUrl = apiUrl.replace(/\/$/, '');
  const url = `${baseUrl}/instances/${instance}/token/${token}/send-text`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      phone: phone,
      message: message,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (response.ok) {
    const data = await response.json();
    return { success: true, details: `Mensagem enviada via Z-API: ${JSON.stringify(data)}` };
  } else {
    const errorText = await response.text().catch(() => 'Unknown error');
    return { success: false, details: `Z-API erro ${response.status}: ${errorText}` };
  }
}

/**
 * Send text message via Evolution API
 */
async function sendViaEvolutionApi(
  apiUrl: string,
  instance: string,
  token: string,
  phone: string,
  message: string
): Promise<{ success: boolean; details: string }> {
  const baseUrl = apiUrl.replace(/\/$/, '');
  const url = `${baseUrl}/message/sendText/${instance}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': token,
    },
    body: JSON.stringify({
      number: phone,
      text: message,
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (response.ok) {
    const data = await response.json();
    return { success: true, details: `Mensagem enviada via Evolution API: ${JSON.stringify(data)}` };
  } else {
    const errorText = await response.text().catch(() => 'Unknown error');
    return { success: false, details: `Evolution API erro ${response.status}: ${errorText}` };
  }
}

/**
 * Send text message via WhatsApp API - tries Z-API first, then Evolution API
 */
async function sendWhatsAppMessage(
  apiUrl: string,
  instance: string,
  token: string,
  phone: string,
  message: string
): Promise<{ success: boolean; details: string; method: string }> {
  // Try Z-API format first (most popular in Brazil)
  const zApiResult = await sendViaZApi(apiUrl, instance, token, phone, message);
  if (zApiResult.success) {
    return { ...zApiResult, method: 'Z-API' };
  }

  // If Z-API fails, try Evolution API format
  const evoResult = await sendViaEvolutionApi(apiUrl, instance, token, phone, message);
  if (evoResult.success) {
    return { ...evoResult, method: 'Evolution API' };
  }

  // Both failed
  return {
    success: false,
    details: `Falha ao enviar via Z-API e Evolution API. Z-API: ${zApiResult.details} | Evolution: ${evoResult.details}`,
    method: 'NONE',
  };
}

// POST /api/whatsapp/send-os - Send OS estimate or receipt via WhatsApp
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, serviceOrderId, mode, customPhone } = body;

    if (!officeId || !serviceOrderId) {
      return NextResponse.json(
        { success: false, error: 'officeId e serviceOrderId são obrigatórios' },
        { status: 400 }
      );
    }

    const sendMode: 'estimate' | 'receipt' = mode === 'receipt' ? 'receipt' : 'estimate';

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

    // Sanitize and extract WhatsApp config - handle users who paste full URLs
    let waApiUrl = sanitizeApiUrl(office.waApiUrl);
    let waInstance = extractInstanceFromUrl(office.waApiUrl, office.waInstance);
    let waApiToken = decryptToken(office.waApiToken) || extractTokenFromUrl(office.waApiUrl, null);

    // If still no token after extraction, error
    if (!waApiToken) {
      return NextResponse.json(
        { success: false, error: 'Token da API do WhatsApp não configurado. Configure o Token no perfil da oficina.' },
        { status: 400 }
      );
    }

    // Log if we corrected the URL
    if (waApiUrl !== office.waApiUrl) {
      console.log(`WhatsApp API URL sanitized: "${office.waApiUrl}" → "${waApiUrl}"`);
    }

    // Get service order with all related data
    const os = await db.serviceOrder.findUnique({
      where: { id: serviceOrderId },
      include: {
        client: {
          select: { id: true, name: true, phone: true, email: true, cpfCnpj: true },
        },
        vehicle: {
          select: { id: true, plate: true, brand: true, model: true, year: true, color: true },
        },
        items: {
          where: { deleted: false },
          select: {
            type: true,
            description: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!os || os.officeId !== officeId) {
      return NextResponse.json(
        { success: false, error: 'Ordem de serviço não encontrada' },
        { status: 404 }
      );
    }

    // Determine recipient phone
    const recipientPhone = customPhone || os.client.phone;
    if (!recipientPhone) {
      return NextResponse.json(
        { success: false, error: 'Cliente não possui telefone cadastrado. Informe um número de WhatsApp.' },
        { status: 400 }
      );
    }

    const formattedPhone = formatWhatsAppPhone(recipientPhone);
    const message = buildOSMessage(
      {
        number: os.number,
        status: os.status,
        description: os.description,
        diagnosis: os.diagnosis,
        totalParts: Number(os.totalParts),
        totalServices: Number(os.totalServices),
        totalDiscount: Number(os.totalDiscount),
        totalAmount: Number(os.totalAmount),
        paymentMethod: os.paymentMethod,
        paidAt: os.paidAt?.toISOString(),
        createdAt: os.createdAt.toISOString(),
        client: { name: os.client.name, phone: os.client.phone },
        vehicle: os.vehicle,
        items: os.items.map(item => ({
          ...item,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          totalPrice: Number(item.totalPrice),
        })),
      },
      { name: office.name, phone: office.phone },
      sendMode
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
    const notification = await db.notification.create({
      data: {
        type: 'WHATSAPP',
        template: sendMode === 'estimate' ? 'OS_ESTIMATE' : 'OS_RECEIPT',
        title: sendMode === 'estimate' ? `Orçamento OS ${os.number}` : `Recibo OS ${os.number}`,
        message: message.substring(0, 500),
        recipient: formattedPhone,
        status: sendResult.success ? 'ENVIADA' : 'FALHOU',
        sentAt: sendResult.success ? new Date() : null,
        serviceOrderId: os.id,
        officeId,
      },
    });

    // Create audit log
    await createAuditLog({
      action: 'SEND_WHATSAPP',
      entity: 'ServiceOrder',
      entityId: os.id,
      details: JSON.stringify({
        mode: sendMode,
        phone: formattedPhone,
        success: sendResult.success,
        method: sendResult.method,
        osNumber: os.number,
      }),
      userId: auth.payload.userId || null,
      officeId,
    });

    return NextResponse.json({
      success: sendResult.success,
      data: {
        notification,
        sendResult,
        phone: formattedPhone,
        osNumber: os.number,
        mode: sendMode,
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
