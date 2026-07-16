import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

// GET /api/mercadopago/subscription-return - Handle return from MP checkout
// SEC-10 FIX: Added requireAuth check and officeId ownership verification
export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      return NextResponse.redirect(`${APP_URL}?mp_return=error&reason=unauthorized`);
    }

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const subscriptionId = searchParams.get('subscriptionId');

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    // If payment was approved, check and update subscription
    if (status === 'success' && subscriptionId) {
      const subscription = await db.subscription.findFirst({
        where: { id: subscriptionId, deleted: false },
      });

      // SEC-10 FIX: Verify subscription belongs to authenticated user's office
      if (!subscription || subscription.officeId !== auth.payload.officeId) {
        return NextResponse.redirect(`${APP_URL}?mp_return=error&reason=forbidden`);
      }

      if (subscription.mpPreferenceId) {
        // Try to verify the payment status directly with MP API
        // This serves as a fallback in case the webhook hasn't been received yet
        const mpAccessToken = process.env.MP_PLATFORM_ACCESS_TOKEN;
        let accessToken = mpAccessToken && !mpAccessToken.includes('xxxxxxxx')
          ? mpAccessToken
          : null;

        // If no platform token, try the office's token
        if (!accessToken && subscription.officeId) {
          const office = await db.office.findUnique({
            where: { id: subscription.officeId },
            select: { mpAccessToken: true, mpEnabled: true },
          });
          if (office?.mpEnabled && office.mpAccessToken) {
            accessToken = office.mpAccessToken;
          }
        }

        if (accessToken) {
          try {
            // Search for payments associated with this preference
            const searchResponse = await fetch(
              `https://api.mercadopago.com/v1/payments/search?preference_id=${subscription.mpPreferenceId}`,
              {
                headers: { Authorization: `Bearer ${accessToken}` },
              }
            );

            if (searchResponse.ok) {
              const searchData = await searchResponse.json();
              const payments = searchData.results || [];

              if (payments.length > 0) {
                // Get the latest payment
                const latestPayment = payments[0];
                const mpStatus = latestPayment.status;
                const mpPaymentId = String(latestPayment.id);

                console.log(`[MP Return] Payment ${mpPaymentId} status: ${mpStatus} for subscription ${subscription.id}`);

                // Update subscription with MP payment info
                await db.subscription.update({
                  where: { id: subscription.id },
                  data: {
                    mpPaymentId,
                    mpStatus,
                  },
                });

                // If payment is approved, activate the subscription
                if (mpStatus === 'approved' && subscription.status !== 'ATIVA') {
                  const now = new Date();
                  const periodEnd = new Date(now);
                  periodEnd.setMonth(periodEnd.getMonth() + 1);

                  await db.subscription.update({
                    where: { id: subscription.id },
                    data: {
                      status: 'ATIVA',
                      currentPeriodStart: now,
                      currentPeriodEnd: periodEnd,
                    },
                  });

                  // Create financial entry
                  const existingFinancial = await db.financialEntry.findFirst({
                    where: {
                      officeId: subscription.officeId,
                      reference: `SUB-MP-${subscription.id}`,
                      deleted: false,
                    },
                  });

                  if (!existingFinancial) {
                    await db.financialEntry.create({
                      data: {
                        officeId: subscription.officeId,
                        type: 'PAGAR',
                        category: 'ASSINATURA',
                        description: `Assinatura Plano ${subscription.plan} - KiteOS (Mercado Pago)`,
                        amount: subscription.monthlyPrice,
                        discount: 0,
                        interest: 0,
                        totalAmount: subscription.monthlyPrice,
                        status: 'PAGO',
                        dueDate: now,
                        paymentDate: now,
                        paymentMethod: 'MERCADO_PAGO',
                        reference: `SUB-MP-${subscription.id}`,
                      },
                    });
                  }

                  // Create notification
                  await db.notification.create({
                    data: {
                      type: 'SYSTEM',
                      title: 'Pagamento Aprovado',
                      message: `Pagamento do plano ${subscription.plan} foi aprovado via Mercado Pago. Valor: R$ ${subscription.monthlyPrice.toFixed(2)}`,
                      status: 'PENDENTE',
                      officeId: subscription.officeId,
                    },
                  });

                  console.log(`[MP Return] Subscription ${subscription.id} ACTIVATED for plan ${subscription.plan}`);
                } else if (mpStatus === 'rejected' || mpStatus === 'cancelled') {
                  // Revert to FREE
                  await db.subscription.update({
                    where: { id: subscription.id },
                    data: {
                      status: 'CANCELADA',
                      plan: 'FREE',
                      monthlyPrice: 0,
                    },
                  });
                  console.log(`[MP Return] Subscription ${subscription.id} REVERTED to FREE - payment ${mpStatus}`);
                } else if (mpStatus === 'pending' || mpStatus === 'in_process') {
                  // Payment still processing - keep PENDENTE
                  console.log(`[MP Return] Subscription ${subscription.id} payment still processing: ${mpStatus}`);
                }
              } else {
                console.log('[MP Return] No payments found for preference yet - payment may still be processing');
              }
            }
          } catch (e) {
            console.error('[MP Return] Error checking payment status:', e);
          }
        }
      }
    }

    // Redirect back to the subscriptions page with status
    const redirectUrl = `${APP_URL}?mp_return=${status || 'unknown'}&sub=${subscriptionId || ''}`;

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error('[MP Return] Error:', error);
    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
    return NextResponse.redirect(`${APP_URL}?mp_return=error`);
  }
}
