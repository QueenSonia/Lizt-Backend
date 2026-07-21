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

/**
 * One-time virtual account for the in-app "pay with transfer" checkout.
 * Everything in NAIRA and normalized — adapters own provider quirks
 * (Monnify: amounts may arrive as strings, accountDurationSeconds counts
 * down on re-calls).
 */
export interface BankTransferDetails {
  bankName: string;
  bankCode: string | null;
  accountNumber: string;
  accountName: string;
  /** Seconds the account stays payable (Monnify accountDurationSeconds). */
  expiresInSeconds: number;
  /** What the payer must actually send, in NAIRA (Monnify totalPayable). */
  amountNaira: number;
  /** Gateway fee portion, informational only — never shown to tenants. */
  feeNaira: number;
}

export interface PaymentGateway {
  /** Stable adapter name ('paystack' | 'monnify' | …). Stored on DB rows. */
  readonly name: string;

  /** Provider name as customers should see it ('Paystack', 'Monnify'). Shown
   *  on the tenant-facing "Secured by …" note; never persisted — `name` is the
   *  stored identity. */
  readonly displayName: string;

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
   * Mint a one-time virtual account for an ALREADY-initialized transaction
   * (the in-app transfer checkout). `gatewayTransactionId` is the provider's
   * transaction handle from initializePayment — use it in the SAME request:
   * its persistence on payment_intents is best-effort only.
   *
   * Returns null when this gateway has no in-app transfer capability
   * (Paystack) — an EXPECTED outcome, not an error: callers fall back to the
   * hosted checkoutUrl, which is also the env-rollback lever. Throws only
   * when the gateway supports it and the call actually failed.
   */
  initializeBankTransfer(
    gatewayTransactionId: string,
  ): Promise<BankTransferDetails | null>;

  /**
   * Validate the webhook HMAC over the RAW request body. Must be
   * constant-time. Returning false means "reject" — the route replies
   * non-committally and drops the event.
   */
  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): boolean;

  /** Map the provider envelope to a normalized event. SHAPE-ONLY and fast —
   *  MUST NOT make network calls: it runs before the webhook 200 is returned.
   *  Never throws on shape surprises — unknown events come back as 'other'. */
  parseWebhookEvent(body: any): GatewayWebhookEvent;

  /**
   * Fill in metadata the webhook envelope omitted, via the gateway's query
   * API. Runs in the DEFERRED (post-200) path so it never delays the ack.
   * Default adapters return the event unchanged; Monnify's REJECTED_PAYMENT
   * events can omit metaData that the renewal rejected processor requires.
   * Best-effort: on failure, return the event as-is.
   */
  hydrateWebhookMetadata(
    event: GatewayWebhookEvent,
  ): Promise<GatewayWebhookEvent>;

  /** Documented webhook source IPs. Logging-only defense-in-depth — the app
   *  sits behind a proxy with `trust proxy`, so req.ip is spoofable; the
   *  HMAC signature is the real guard. */
  allowedSourceIps(): string[];
}

/** Injection token for the active gateway (resolved from PAYMENT_GATEWAY env
 *  by GatewayRegistryService at boot). */
export const ACTIVE_PAYMENT_GATEWAY = Symbol('ACTIVE_PAYMENT_GATEWAY');
