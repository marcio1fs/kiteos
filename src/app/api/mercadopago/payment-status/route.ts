import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/logger';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { decryptToken } from '@/lib/token-encryption';

// GET /api/mercadopago/payment-status - Check payment status by saleId (polling)
// AUD-C06 FIX: Added requireAuth — was completely unauthenticated
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json({ success: false, error: auth.error.message }, { status: auth.error.status });
    }

    const { searchParams } = new URL(request.url);
    const saleId = searchParams.get('saleId');
    const refresh = searchParams.get('refresh') === 'true';

    // AUD-C06 FIX: Use authenticated officeId instead of query param
    const officeId = auth.payload.officeId;

    if (!saleId) {
      return NextResponse.json(
        { success: false, error: 'saleId é obrigatório' },
        { status: 400 }
      );
    }

    // Find the sale scoped to authenticated office
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

    // If there's an external reference, try to check MP status
    if (refresh && sale.number) {
      const office = await db.office.findUnique({ where: { id: officeId } });
      // AUD-C06 FIX: Decrypt token before use
      if (office?.mpAccessToken) {
        const accessToken = decryptToken(office.mpAccessToken) || office.mpAccessToken;
        try {
          // Search for payment by external reference
          const mpResponse = await fetch(
            `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(sale.number)}`,
            {
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );

          if (mpResponse.ok) {
            const mpData = await mpResponse.json();
            const mpPayment = mpData.results?.[0];

            if (mpPayment) {
              const statusMap: Record<string, string> = {
                pending: 'PENDENTE',
                approved: 'APROVADO',
                authorized: 'PENDENTE',
                in_process: 'PENDENTE',
                in_mediation: 'PENDENTE',
                rejected: 'REJEITADO',
                cancelled: 'CANCELADO',
                refunded: 'ESTORNADO',
                charged_back: 'ESTORNADO',
              };

              const mpStatus = statusMap[mpPayment.status] || 'PENDENTE';

              // If approved, update sale
              if (mpStatus === 'APROVADO' && sale.status !== 'PAGA') {
                const paidAt = mpPayment.date_approved ? new Date(mpPayment.date_approved) : new Date();
                await db.sale.update({
                  where: { id: sale.id },
                  data: { status: 'PAGA', paymentMethod: 'MERCADO_PAGO', paidAt },
                });

                // Create financial entry
                await db.financialEntry.create({
                  data: {
                    type: 'RECEBER',
                    category: 'PDV',
                    description: `Venda PDV ${sale.number} (Mercado Pago)`,
                    amount: Number(sale.totalAmount),
                    discount: Number(sale.discount),
                    interest: 0,
                    totalAmount: Number(sale.totalAmount) - Number(sale.discount),
                    status: 'PAGO',
                    dueDate: new Date(),
                    paymentDate: paidAt,
                    paymentMethod: 'MERCADO_PAGO',
                    reference: sale.number,
                    saleId: sale.id,
                    officeId,
                  },
                });

                return NextResponse.json({
                  success: true,
                  data: {
                    saleId: sale.id,
                    number: sale.number,
                    status: 'PAGA',
                    mpStatus: mpPayment.status,
                    amount: Number(sale.totalAmount),
                    paidAt,
                  },
                });
              }

              return NextResponse.json({
                success: true,
                data: {
                  saleId: sale.id,
                  number: sale.number,
                  status: sale.status,
                  mpStatus: mpPayment.status,
                  amount: Number(sale.totalAmount),
                },
              });
            }
          }
        } catch (e) {
          logger.error('Error refreshing payment status', { error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        saleId: sale.id,
        number: sale.number,
        status: sale.status,
        amount: Number(sale.totalAmount),
        items: sale.items,
      },
    });
  } catch (error) {
    logger.error('Error checking payment status', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao verificar status do pagamento' },
      { status: 500 }
    );
  }
}
