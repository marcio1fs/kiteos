import { WebhookSignatureValidator } from 'mercadopago';

/**
 * Official Mercado Pago Webhooks signature validation.
 * Manifest: id:<data.id>;request-id:<x-request-id>;ts:<ts>;
 * The raw JSON body is NOT part of the manifest.
 */
export function validateMpSignature(args: {
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string | null;
  secret: string;
}): boolean {
  if (!args.secret || !args.dataId) return false;
  try {
    WebhookSignatureValidator.validate({
      xSignature: args.xSignature,
      xRequestId: args.xRequestId,
      dataId: args.dataId.toLowerCase(),
      secret: args.secret,
      toleranceSeconds: 300,
    });
    return true;
  } catch {
    return false;
  }
}

export interface MpPayment {
  id: number | string;
  status: string;
  transaction_amount?: number;
  currency_id?: string;
  external_reference?: string | null;
  preference_id?: string | null;
  collector_id?: number | string;
  date_approved?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** Always re-fetch the payment from MP; never trust amounts/status in the webhook body. */
export async function fetchMpPayment(paymentId: string, accessToken: string): Promise<MpPayment | null> {
  if (!/^\d+$/.test(paymentId)) return null;
  const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
    cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Mercado Pago respondeu ${response.status}`);
  return response.json() as Promise<MpPayment>;
}
