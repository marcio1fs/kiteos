import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import MercadoPagoConfig, { Payment, Preference } from 'mercadopago';
import { decryptToken } from '@/lib/token-encryption';
import { requireAuth } from '@/lib/auth';
import { CommercialError, toCents, fromCents } from '@/lib/commercial';
import { requireAppUrl } from '@/lib/env';

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

    if (sale.status !== 'ABERTA') {
      return NextResponse.json({ success: false, error: 'Apenas vendas em aberto podem gerar cobrança' }, { status: 409 });
    }
    const totalCents = toCents(Number(sale.totalAmount));
    if (totalCents <= 0) {
      return NextResponse.json({ success: false, error: 'Venda com total zero não pode gerar cobrança' }, { status: 400 });
    }
    const externalReference = `SALE:${officeId}:${sale.id}`;

    // Configure Mercado Pago SDK with decrypted token
    const client = new MercadoPagoConfig({
      accessToken: decryptedAccessToken,
    });

    // Build items for MP. Allocate the sale discount proportionally so the
    // preference total equals sale.totalAmount exactly (in cents).
    const grossCents = sale.items.reduce((sum, item) => sum + Math.round(toCents(Number(item.unitPrice)) * Number(item.quantity)), 0);
    let allocated = 0;
    const items = sale.items.map((item, index) => {
      const lineGross = Math.round(toCents(Number(item.unitPrice)) * Number(item.quantity));
      const lineNet = index === sale.items.length - 1
        ? totalCents - allocated
        : Math.round(lineGross * totalCents / grossCents);
      allocated += lineNet;
      const quantity = Number(item.quantity);
      return {
        id: item.partId || item.id,
        title: item.description,
        unit_price: fromCents(Math.round(lineNet / quantity)),
        quantity,
        currency_id: 'BRL' as const,
      };
    });
    // Rounding per-unit can drift for fractional quantities; use a single
    // consolidated line when that happens so MP never charges a different total.
    const preferenceTotal = items.reduce((sum, i) => sum + Math.round(toCents(i.unit_price) * i.quantity), 0);
    const mpItems = preferenceTotal === totalCents ? items : [{
      id: sale.id, title: `Venda ${sale.number}`, unit_price: fromCents(totalCents), quantity: 1, currency_id: 'BRL' as const,
    }];

    // Create preference
    // PASSO 6 (CFG-03): sem NEXT_PUBLIC_APP_URL configurado isto lança em vez de
    // mandar o Mercado Pago chamar http://localhost:3000 — que é o que o fallback
    // antigo fazia, inclusive em produção, quebrando retorno do checkout e webhook.
    const appUrl = requireAppUrl();

    const preferenceBody = {
      items: mpItems,
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
        success: `${appUrl}/api/mercadopago/success`,
        failure: `${appUrl}/api/mercadopago/failure`,
        pending: `${appUrl}/api/mercadopago/pending`,
      },
      notification_url: `${appUrl}/api/mercadopago/webhook`,
      external_reference: externalReference,
      statement_descriptor: 'KITEOS',
    };

    const preference = new Preference(client);
    const result = await preference.create({ body: preferenceBody, requestOptions: { idempotencyKey: `pref-${sale.id}-${totalCents}` } });

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
            external_reference: externalReference,
          },
          requestOptions: { idempotencyKey: `pix-${sale.id}-${totalCents}` },
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
