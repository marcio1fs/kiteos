import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import MercadoPagoConfig, { Payment, Preference } from 'mercadopago';
import { decryptToken } from '@/lib/token-encryption';
import { requireAuth } from '@/lib/auth';

// POST /api/mercadopago/create-payment - Create a payment preference for a sale
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { officeId, saleId, paymentMethod } = body;

    if (!officeId || !saleId) {
      return NextResponse.json(
        { success: false, error: 'officeId e saleId são obrigatórios' },
        { status: 400 }
      );
    }

    // SECURITY FIX (AUD-02): Added authentication check — was completely unauthenticated!
    // Any request could create MP payments for any office.
    const auth = await requireAuth(request, officeId);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error?.message || 'Não autorizado' },
        { status: auth.error?.status || 401 }
      );
    }

    // Get office with MP credentials
    const office = await db.office.findUnique({
      where: { id: officeId },
    });

    if (!office) {
      return NextResponse.json(
        { success: false, error: 'Oficina não encontrada' },
        { status: 404 }
      );
    }

    // SECURITY FIX (AUD-02): Decrypt access token before use
    const decryptedAccessToken = decryptToken(office.mpAccessToken);
    if (!decryptedAccessToken || !office.mpEnabled) {
      return NextResponse.json(
        { success: false, error: 'Mercado Pago não configurado. Configure nas definições da oficina.' },
        { status: 400 }
      );
    }

    // Get the sale
    const sale = await db.sale.findFirst({
      where: { id: saleId, officeId, deleted: false },
      include: { items: { where: { deleted: false } }, client: true },
    });

    if (!sale) {
      return NextResponse.json(
        { success: false, error: 'Venda não encontrada' },
        { status: 404 }
      );
    }

    // Configure Mercado Pago SDK with decrypted token
    const client = new MercadoPagoConfig({
      accessToken: decryptedAccessToken,
    });

    // Build items for MP
    const items = sale.items.map(item => ({
      id: item.partId || item.id,
      title: item.description,
      unit_price: Number(item.unitPrice),
      quantity: Number(item.quantity),
      currency_id: 'BRL' as const,
    }));

    // Create preference
    const preferenceBody = {
      items,
      payer: sale.client ? {
        name: sale.client.name,
        email: sale.client.email || undefined,
        identification: sale.client.cpfCnpj ? {
          type: sale.client.cpfCnpj.length > 14 ? 'CNPJ' : 'CPF',
          number: sale.client.cpfCnpj.replace(/\D/g, ''),
        } : undefined,
      } : undefined,
      payment_methods: {
        ...(paymentMethod === 'PIX' && {
          excluded_payment_methods: [{ id: 'visa' }, { id: 'master' }, { id: 'elo' }, { id: 'amex' }],
          excluded_payment_types: [{ id: 'credit_card' }, { id: 'debit_card' }, { id: 'ticket' }],
        }),
        ...(paymentMethod === 'CARTAO_CREDITO' && {
          excluded_payment_types: [{ id: 'pix' }, { id: 'ticket' }],
          installments: 12,
        }),
        ...(paymentMethod === 'CARTAO_DEBITO' && {
          excluded_payment_types: [{ id: 'pix' }, { id: 'credit_card' }, { id: 'ticket' }],
        }),
        default_installments: 1,
      },
      back_urls: {
        success: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/mercadopago/success`,
        failure: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/mercadopago/failure`,
        pending: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/mercadopago/pending`,
      },
      notification_url: `${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/mercadopago/webhook`,
      external_reference: sale.number,
      statement_descriptor: 'KITEOS',
    };

    const preference = new Preference(client);
    const result = await preference.create({ body: preferenceBody });

    // For PIX, generate QR code
    if (paymentMethod === 'PIX') {
      try {
        const paymentApi = new Payment(client);
        const pixPayment = await paymentApi.create({
          body: {
            transaction_amount: Number(sale.totalAmount),
            description: `Venda PDV ${sale.number}`,
            payment_method_id: 'pix',
            payer: sale.client ? {
              email: sale.client.email || office.email,
              first_name: sale.client.name.split(' ')[0],
              last_name: sale.client.name.split(' ').slice(1).join(' ') || 'N/A',
              identification: sale.client.cpfCnpj ? {
                type: sale.client.cpfCnpj.length > 14 ? 'CNPJ' : 'CPF',
                number: sale.client.cpfCnpj.replace(/\D/g, ''),
              } : undefined,
            } : {
              email: office.email || '',
            },
            external_reference: sale.number,
          },
        });

        const qrCodeBase64 = pixPayment.point_of_interaction?.transaction_data?.qr_code_base64 || null;
        const qrCode = pixPayment.point_of_interaction?.transaction_data?.qr_code || null;

        return NextResponse.json({
          success: true,
          data: {
            mpPaymentId: String(pixPayment.id),
            mpPreferenceId: result.id,
            mpQrCode: qrCode,
            mpQrCodeBase64: qrCodeBase64,
            status: pixPayment.status,
          },
        });
      } catch (pixError: unknown) {
        logger.error('PIX payment creation error', { pixError: pixError instanceof Error ? pixError.message : String(pixError) });
        const errMsg = pixError instanceof Error ? pixError.message : 'Erro ao criar pagamento PIX';
        return NextResponse.json(
          { success: false, error: `Erro no pagamento PIX: ${errMsg}` },
          { status: 500 }
        );
      }
    }

    // For card payments, return preference info
    return NextResponse.json({
      success: true,
      data: {
        mpPreferenceId: result.id,
        initPoint: result.init_point,
        sandboxInitPoint: result.sandbox_init_point,
        status: 'pending',
      },
    });
  } catch (error: unknown) {
    logger.error('Error creating MP payment', { error: error instanceof Error ? error.message : String(error) });
    const errMsg = error instanceof Error ? error.message : 'Erro ao criar pagamento';
    return NextResponse.json(
      { success: false, error: errMsg },
      { status: 500 }
    );
  }
}
