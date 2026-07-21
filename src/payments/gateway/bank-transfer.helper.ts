import {
  BankTransferDetails,
  InitializePaymentResult,
  PaymentGateway,
} from './payment-gateway.interface';

/** Structural logger — satisfied by both Nest's Logger and PaystackLogger. */
interface TransferLogger {
  warn(message: string, ...meta: any[]): void;
}

/**
 * Fetch the one-time virtual account for a just-initialized transaction —
 * the second half of the in-app transfer checkout, composed in the SAME
 * request as initializePayment because the transactionReference's
 * persistence on payment_intents is best-effort (attachIntentCheckout).
 *
 * NEVER throws. `transfer: null` in an init response means "no in-app
 * panel" and the frontend falls back to the hosted checkoutUrl redirect,
 * so any failure here degrades to the exact pre-feature behavior instead
 * of blocking a tenant who is about to pay. That guarantee is also the
 * rollback story: PAYMENT_GATEWAY=paystack returns null from the adapter
 * itself and every lane reverts with zero code changes.
 */
export async function fetchBankTransferDetails(
  gateway: PaymentGateway,
  init: InitializePaymentResult,
  logger: TransferLogger,
): Promise<BankTransferDetails | null> {
  if (!init.gatewayTransactionId) return null;
  try {
    return await gateway.initializeBankTransfer(init.gatewayTransactionId);
  } catch (err) {
    logger.warn(
      `Bank-transfer account fetch failed for ${init.reference} — falling back to hosted checkout: ${(err as Error).message}`,
    );
    return null;
  }
}
