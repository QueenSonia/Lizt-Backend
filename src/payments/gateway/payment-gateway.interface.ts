/**
 * Gateway-neutral payment abstraction.
 *
 * Everything OUTSIDE the adapters speaks naira (major units) and normalized
 * channel strings — the adapters own unit conversion (Paystack: kobo) and
 * channel-name normalization (Monnify: ACCOUNT_TRANSFER → bank_transfer).
 * Business services and the webhook router must only depend on the types in
 * this file; swapping gateways means writing one new adapter class and
 * registering it — zero changes elsewhere.
 */

/** Normalized checkout channels. Adapters translate to provider vocabulary. */
export type PaymentChannel = 'card' | 'bank_transfer' | 'ussd' | 'phone';

export interface InitializePaymentParams {
  /** Amount in NAIRA (major units). Adapters convert if their API differs. */
  amountNaira: number;
  email: string;
  customerName?: string;
  /**
   * OUR merchant-side reference (LIZT_/RENEWAL_/PLAN_/PLANPAYOFF_/INV_
   * prefixed). Echoed back verbatim by the gateway in webhooks/verify — the
   * webhook router keys its routing on these prefixes.
   */
  reference: string;
  /** Where the hosted checkout redirects the customer after payment. */
  callbackUrl: string;
  /**
   * Round-trips through the gateway back to us in webhooks. NOTE: some
   * gateways (Monnify) may return values as strings — consumers must not
   * assume types.
   */
  metadata: Record<string, any>;
  description?: string;
  /** Restrict the checkout to these channels. Adapters translate. */
  channels?: PaymentChannel[];
}

export interface InitializePaymentResult {
  /** Our reference, echoed back. */
  reference: string;
  /** Hosted-checkout URL to redirect the customer to. */
  checkoutUrl: string;
  /**
   * Gateway-side transaction handle (Paystack access_code / Monnify
   * transactionReference — the latter contains pipes, always
   * encodeURIComponent before putting it in a URL path).
   */
  gatewayTransactionId: string | null;
  /** Adapter name that issued this payment — persist it on the row. */
  gateway: string;
}

/**
 * The one event shape every webhook/verify processor consumes. No kobo, no
 * provider field names, no `/100` anywhere outside adapters.
 */
export interface NormalizedPaymentEvent {
  reference: string;
  /** Amount actually paid, in NAIRA. */
  amountNaira: number;
  /** Normalized channel: 'card' | 'bank_transfer' | 'ussd' | 'phone' | ... */
  channel: string;
  paidAt: Date | null;
  /** Human-readable gateway detail (e.g. transfer-rejection reason). */
  gatewayResponse?: string;
  /** Init-time metadata echoed back. Values may arrive as strings. */
  metadata: Record<string, any> | null;
  /** Adapter name (always `adapter.name`). */
  gateway: string;
  /** Original gateway payload — logging/audit only, never business logic. */
  raw: unknown;
}

export type VerifyStatus = 'success' | 'pending' | 'failed';

export interface VerifyPaymentResult extends NormalizedPaymentEvent {
  status: VerifyStatus;
  /** The gateway's own status string (PAID / PARTIALLY_PAID / abandoned / …). */
  rawStatus: string;
  /**
   * TRUE whenever real money reached the gateway — including partial and
   * over-payments that normalize to `pending`. A `pending` result with
   * moneyReceived=true must NEVER be silently failed (cron) or dropped:
   * surface it for ops reconciliation instead.
   */
  moneyReceived: boolean;
}

export type GatewayWebhookEventType =
  | 'payment.success'
  /** Customer-side transfer rejected/returned by the gateway. */
  | 'transfer.rejected'
  /**
   * Money received but ≠ the requested amount (Monnify PARTIALLY_PAID /
   * OVERPAID). Must produce an ops-visible artifact, never a silent log.
   */
  | 'payment.amount_mismatch'
  | 'other';

export interface GatewayWebhookEvent extends NormalizedPaymentEvent {
  type: GatewayWebhookEventType;
  /** The gateway's own event name, for logging. */
  rawEventType: string;
}

/** Thrown when the gateway has never seen this reference (NOT for transient
 *  network/5xx/auth failures — those must surface as ordinary errors so
 *  fallback probing and never_initiated classification don't fire on blips). */
export class GatewayReferenceNotFoundError extends Error {
  constructor(
    public readonly reference: string,
    message?: string,
  ) {
    super(message ?? `Payment reference not found on gateway: ${reference}`);
    this.name = 'GatewayReferenceNotFoundError';
  }
}

/** Thrown when the gateway rejects an initialization because the merchant
 *  reference was already used. Callers regenerate the reference and retry. */
export class DuplicateReferenceError extends Error {
  constructor(
    public readonly reference: string,
    message?: string,
  ) {
    super(message ?? `Duplicate payment reference on gateway: ${reference}`);
    this.name = 'DuplicateReferenceError';
  }
}

export interface PaymentGateway {
  /** Stable adapter name ('paystack' | 'monnify' | …). Stored on DB rows. */
  readonly name: string;

  /** How long this gateway's checkout stays payable, in minutes
   *  (Paystack access codes ~30, Monnify checkoutUrl 40). */
  readonly checkoutExpiryMinutes: number;

  /** Throws DuplicateReferenceError when the reference was already used. */
  initializePayment(
    params: InitializePaymentParams,
  ): Promise<InitializePaymentResult>;

  /** Throws GatewayReferenceNotFoundError when the gateway never saw it. */
  verifyPayment(reference: string): Promise<VerifyPaymentResult>;

  /**
   * Validate the webhook HMAC over the RAW request body. Must be
   * constant-time. Returning false means "reject" — the route replies
   * non-committally and drops the event.
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): boolean;

  /** Map the provider envelope to a normalized event. Never throws on shape
   *  surprises — unknown events come back as type 'other'. May be async:
   *  some adapters hydrate missing metadata via their query API (Monnify's
   *  REJECTED_PAYMENT events can omit metaData, and the renewal rejected
   *  processor hard-requires metadata.renewal_invoice_id). */
  parseWebhookEvent(
    body: any,
  ): GatewayWebhookEvent | Promise<GatewayWebhookEvent>;

  /** Documented webhook source IPs. Logging-only defense-in-depth — the app
   *  sits behind a proxy with `trust proxy`, so req.ip is spoofable; the
   *  HMAC signature is the real guard. */
  allowedSourceIps(): string[];
}

/** Injection token for the active gateway (resolved from PAYMENT_GATEWAY env
 *  by GatewayRegistryService at boot). */
export const ACTIVE_PAYMENT_GATEWAY = Symbol('ACTIVE_PAYMENT_GATEWAY');
