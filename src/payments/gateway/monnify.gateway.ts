import { HttpService } from '@nestjs/axios';
import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AxiosError, AxiosRequestConfig } from 'axios';
import * as crypto from 'crypto';
import { firstValueFrom } from 'rxjs';
import {
  DuplicateReferenceError,
  GatewayReferenceNotFoundError,
  GatewayWebhookEvent,
  GatewayWebhookEventType,
  InitializePaymentParams,
  InitializePaymentResult,
  PaymentGateway,
  VerifyPaymentResult,
  VerifyStatus,
} from './payment-gateway.interface';

// Monnify's documented webhook source IP (logging-only defense — see
// PaymentGateway.allowedSourceIps()).
const MONNIFY_IPS = ['35.242.133.146'];

/** Monnify paymentMethod → our normalized channel vocabulary. */
const CHANNEL_MAP: Record<string, string> = {
  CARD: 'card',
  ACCOUNT_TRANSFER: 'bank_transfer',
  USSD: 'ussd',
  PHONE_NUMBER: 'phone',
};

/** Our normalized channels → Monnify checkout paymentMethods. */
const PAYMENT_METHOD_MAP: Record<string, string> = {
  card: 'CARD',
  bank_transfer: 'ACCOUNT_TRANSFER',
  ussd: 'USSD',
  phone: 'PHONE_NUMBER',
};

interface MonnifyEnvelope<T> {
  requestSuccessful: boolean;
  responseMessage: string;
  responseCode: string;
  responseBody: T;
}

/**
 * Monnify adapter — the ACTIVE gateway. Hosted-checkout flow: init returns a
 * checkoutUrl (valid ~40 min) the frontend redirects to; Monnify redirects
 * back to our callbackUrl with paymentReference/transactionReference query
 * params, and the SUCCESSFUL_TRANSACTION webhook fires independently.
 *
 * Peculiarities this class owns so nothing else has to know them:
 *  - amounts are NAIRA on the wire but may come back as strings → Number();
 *  - auth is a ~1h bearer token from apiKey:secret → single-flight cache;
 *  - `paidOn` arrives in TWO formats ("YYYY-MM-DD HH:mm:ss[.SSS]" on v2
 *    webhooks, day-first "d/M/yyyy h:mm:ss AM/PM" on the query API), both
 *    Africa/Lagos wall-clock → parseMonnifyDate();
 *  - transactionReference contains pipes ("MNFY|12|…") → we verify by OUR
 *    paymentReference instead and encodeURIComponent everything;
 *  - PARTIALLY_PAID / OVERPAID mean money WAS received → moneyReceived=true,
 *    normalized 'pending' (verify) / 'payment.amount_mismatch' (webhook);
 *  - the rejected-payment eventType is REJECTED_PAYMENT (singular — the docs
 *    heading is plural); such events can omit metaData, which the renewal
 *    rejected processor requires → hydrate via the query API;
 *  - no documented duplicate-reference responseCode → detect 4xx +
 *    requestSuccessful=false + /duplicate/i (capture the real code during
 *    sandbox smoke and tighten).
 */
@Injectable()
export class MonnifyGateway implements PaymentGateway {
  readonly name = 'monnify';
  /** Monnify checkoutUrls stay payable for ~40 minutes. */
  readonly checkoutExpiryMinutes = 40;

  private readonly logger = new Logger(MonnifyGateway.name);
  private readonly maxRetries = 3;
  private readonly retryDelay = 1000;

  /** Single-flight token cache: concurrent callers share ONE login request;
   *  the promise is cleared on rejection so the next caller retries. */
  private tokenPromise: Promise<{ token: string; expiresAtMs: number }> | null =
    null;

  constructor(
    private readonly httpService: HttpService,
    private readonly configService: ConfigService,
  ) {}

  // ── Config (validated lazily — the app must boot without Monnify creds) ──

  private baseUrl(): string {
    return (
      this.configService.get<string>('MONNIFY_BASE_URL') ??
      'https://sandbox.monnify.com'
    );
  }

  private getCredentials(): { apiKey: string; secretKey: string } {
    const apiKey = this.configService.get<string>('MONNIFY_API_KEY');
    const secretKey = this.configService.get<string>('MONNIFY_SECRET_KEY');
    if (!apiKey || !secretKey) {
      this.logger.error('MONNIFY_API_KEY / MONNIFY_SECRET_KEY not configured');
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Monnify gateway not configured',
          error: 'GatewayNotConfigured',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return { apiKey, secretKey };
  }

  private getContractCode(): string {
    const contractCode = this.configService.get<string>(
      'MONNIFY_CONTRACT_CODE',
    );
    if (!contractCode) {
      this.logger.error('MONNIFY_CONTRACT_CODE not configured');
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: 'Monnify gateway not configured',
          error: 'GatewayNotConfigured',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return contractCode;
  }

  // ── Auth ────────────────────────────────────────────────────────────────

  private async getToken(): Promise<string> {
    const existing = this.tokenPromise;
    if (existing) {
      try {
        const cached = await existing;
        // Refresh when <60s of validity remains.
        if (cached.expiresAtMs - Date.now() > 60_000) {
          return cached.token;
        }
      } catch {
        // fall through to a fresh login
      }
    }

    const fresh = this.login();
    this.tokenPromise = fresh;
    fresh.catch(() => {
      // Clear a failed login so the next caller retries instead of awaiting
      // a rejected promise forever.
      if (this.tokenPromise === fresh) this.tokenPromise = null;
    });
    return (await fresh).token;
  }

  private async login(): Promise<{ token: string; expiresAtMs: number }> {
    const { apiKey, secretKey } = this.getCredentials();
    const basic = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');

    const response = await firstValueFrom(
      this.httpService.post(
        `${this.baseUrl()}/api/v1/auth/login`,
        {},
        { headers: { Authorization: `Basic ${basic}` } },
      ),
    );

    const body = response.data as MonnifyEnvelope<{
      accessToken: string;
      expiresIn: number;
    }>;
    if (!body?.requestSuccessful || !body.responseBody?.accessToken) {
      throw new HttpException(
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          message: `Monnify login failed: ${body?.responseMessage ?? 'no token in response'}`,
          error: 'GatewayAuthFailed',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const expiresInSec = Number(body.responseBody.expiresIn) || 3600;
    return {
      token: body.responseBody.accessToken,
      expiresAtMs: Date.now() + expiresInSec * 1000,
    };
  }

  /**
   * Authenticated request with retry on transients ONLY (network / 5xx /
   * 408 / 429) and a one-shot token refresh on 401. Other 4xx fail fast so
   * duplicate/not-found probes never burn backoff time.
   */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    data?: unknown,
  ): Promise<MonnifyEnvelope<T>> {
    let refreshedOn401 = false;
    let lastError: any;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const token = await this.getToken();
        const config: AxiosRequestConfig = {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        };
        const url = `${this.baseUrl()}${path}`;
        const response =
          method === 'GET'
            ? await firstValueFrom(this.httpService.get(url, config))
            : await firstValueFrom(this.httpService.post(url, data, config));
        return response.data as MonnifyEnvelope<T>;
      } catch (error) {
        lastError = error;

        // Deterministic non-transport errors (e.g. the 503 thrown by
        // getCredentials/getContractCode when Monnify isn't configured, or a
        // GatewayNotConfigured on login) are not Axios errors and will never
        // succeed on retry — fail fast instead of burning 3× backoff.
        if (!(error as AxiosError)?.isAxiosError) {
          throw error;
        }

        const status = (error as AxiosError)?.response?.status;

        // Expired/invalid token: drop the cache, re-login, retry once.
        if (status === 401 && !refreshedOn401) {
          refreshedOn401 = true;
          this.tokenPromise = null;
          continue;
        }

        // Deterministic client errors never succeed on retry.
        if (
          status &&
          status >= 400 &&
          status < 500 &&
          status !== 408 &&
          status !== 429
        ) {
          throw error;
        }

        if (attempt < this.maxRetries) {
          const delay = this.retryDelay * attempt;
          this.logger.warn(
            `Monnify request failed (attempt ${attempt}/${this.maxRetries}), retrying in ${delay}ms…`,
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  // ── PaymentGateway implementation ───────────────────────────────────────

  async initializePayment(
    params: InitializePaymentParams,
  ): Promise<InitializePaymentResult> {
    const paymentMethods = (params.channels ?? ['card', 'bank_transfer'])
      .map((channel) => PAYMENT_METHOD_MAP[channel])
      .filter(Boolean);

    let body: MonnifyEnvelope<{
      transactionReference: string;
      paymentReference: string;
      checkoutUrl: string;
    }>;
    try {
      body = await this.request('POST', '/api/v1/merchant/transactions/init-transaction', {
        amount: params.amountNaira, // Monnify takes NAIRA (major units)
        customerName: params.customerName?.trim() || params.email,
        customerEmail: params.email,
        paymentReference: params.reference,
        paymentDescription: params.description ?? 'Property Kraft payment',
        currencyCode: 'NGN',
        contractCode: this.getContractCode(),
        redirectUrl: params.callbackUrl,
        paymentMethods,
        metaData: params.metadata,
      });
    } catch (error) {
      throw this.toTypedInitError(error, params.reference);
    }

    if (!body.requestSuccessful || !body.responseBody?.checkoutUrl) {
      if (/duplicate/i.test(body.responseMessage ?? '')) {
        throw new DuplicateReferenceError(params.reference, body.responseMessage);
      }
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          message: `Monnify init failed: ${body.responseMessage ?? 'no checkoutUrl'}`,
          error: 'GatewayInitFailed',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    return {
      reference: body.responseBody.paymentReference,
      checkoutUrl: body.responseBody.checkoutUrl,
      // Contains pipes ("MNFY|12|…") — encodeURIComponent before URL use.
      gatewayTransactionId: body.responseBody.transactionReference,
      gateway: this.name,
    };
  }

  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    let body: MonnifyEnvelope<any>;
    try {
      // Query by OUR merchant reference — callers never hold the piped
      // transactionReference.
      body = await this.request(
        'GET',
        `/api/v2/merchant/transactions/query?paymentReference=${encodeURIComponent(reference)}`,
      );
    } catch (error) {
      throw this.toTypedVerifyError(error, reference);
    }

    if (!body.requestSuccessful || !body.responseBody) {
      if (this.looksLikeNotFound(body.responseMessage)) {
        throw new GatewayReferenceNotFoundError(reference, body.responseMessage);
      }
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          message: `Monnify verify failed: ${body.responseMessage ?? 'empty response'}`,
          error: 'GatewayVerifyFailed',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }

    const d = body.responseBody;
    const rawStatus: string = String(d.paymentStatus ?? '').toUpperCase();

    const status: VerifyStatus =
      rawStatus === 'PAID'
        ? 'success'
        : rawStatus === 'FAILED' ||
            rawStatus === 'EXPIRED' ||
            rawStatus === 'REVERSED' ||
            rawStatus === 'CANCELLED'
          ? 'failed'
          : 'pending'; // PENDING | PARTIALLY_PAID | OVERPAID | unknown

    const moneyReceived =
      rawStatus === 'PAID' ||
      rawStatus === 'PARTIALLY_PAID' ||
      rawStatus === 'OVERPAID';

    if (rawStatus === 'PARTIALLY_PAID' || rawStatus === 'OVERPAID') {
      this.logger.warn(
        `Monnify reports ${rawStatus} for ${reference}: ₦${this.toNaira(d.amountPaid)} received vs ₦${this.toNaira(d.totalPayable)} payable — money is at the gateway without a clean success`,
      );
    }

    return {
      status,
      rawStatus,
      moneyReceived,
      reference: d.paymentReference ?? reference,
      amountNaira: this.toNaira(d.amountPaid),
      channel: this.toChannel(d.paymentMethod),
      paidAt: this.parseMonnifyDate(d.paidOn),
      gatewayResponse:
        rawStatus === 'PAID' ? undefined : `Monnify status: ${rawStatus}`,
      metadata: this.toMetadata(d.metaData),
      gateway: this.name,
      raw: body,
    };
  }

  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const headerValue = headers['monnify-signature'];
    const signature = Array.isArray(headerValue) ? headerValue[0] : headerValue;

    if (!signature) {
      // Docs say the signature is sent on every notification, sandbox
      // included — verify everywhere by default. If sandbox E2E proves
      // otherwise, the explicit opt-in below (never bare NODE_ENV) can allow
      // unsigned events.
      if (
        this.configService.get<string>('MONNIFY_ALLOW_UNSIGNED_WEBHOOKS') ===
        'true'
      ) {
        this.logger.warn(
          'Accepting UNSIGNED Monnify webhook (MONNIFY_ALLOW_UNSIGNED_WEBHOOKS=true) — never enable in production',
        );
        return true;
      }
      return false;
    }

    const secretKey = this.configService.get<string>('MONNIFY_SECRET_KEY');
    if (!secretKey) {
      this.logger.warn(
        'MONNIFY_SECRET_KEY not configured — rejecting Monnify webhook',
      );
      return false;
    }

    const hash = crypto
      .createHmac('sha512', secretKey)
      .update(rawBody)
      .digest('hex');

    const a = Buffer.from(hash, 'utf8');
    const b = Buffer.from(signature, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhookEvent(body: any): GatewayWebhookEvent {
    // SHAPE ONLY — no network. Metadata that Monnify omits is filled later by
    // hydrateWebhookMetadata() in the deferred path so the 200 ack is fast.
    const rawEventType: string = String(body?.eventType ?? '')
      .trim()
      .toUpperCase();
    const d = body?.eventData ?? {};
    const rawStatus: string = String(d.paymentStatus ?? '').toUpperCase();

    let type: GatewayWebhookEventType = 'other';
    if (rawEventType === 'SUCCESSFUL_TRANSACTION') {
      // PARTIALLY_PAID / OVERPAID inside a SUCCESSFUL_TRANSACTION envelope =
      // money received but ≠ requested → dedicated mismatch event, never the
      // silent 'other' branch. Missing paymentStatus is treated as PAID (the
      // envelope itself asserts success).
      type =
        rawStatus === '' || rawStatus === 'PAID'
          ? 'payment.success'
          : 'payment.amount_mismatch';
    } else if (
      rawEventType === 'REJECTED_PAYMENT' ||
      rawEventType === 'REJECTED_PAYMENTS' // defensive: docs heading is plural
    ) {
      type = 'transfer.rejected';
    }

    const rejectionReason =
      d.paymentRejectionInformation?.rejectionReason ??
      d.paymentRejectionInformation?.reason;
    const expectedAmount = d.paymentRejectionInformation?.expectedAmount;

    return {
      type,
      rawEventType,
      reference: d.paymentReference ?? '',
      amountNaira: this.toNaira(d.amountPaid ?? d.amount),
      channel: this.toChannel(d.paymentMethod),
      paidAt: this.parseMonnifyDate(d.paidOn),
      gatewayResponse:
        type === 'transfer.rejected'
          ? [
              rejectionReason ?? 'Rejected by Monnify',
              expectedAmount != null
                ? `expected ₦${this.toNaira(expectedAmount).toLocaleString()}`
                : null,
            ]
              .filter(Boolean)
              .join(' — ')
          : type === 'payment.amount_mismatch'
            ? `Monnify status: ${rawStatus}`
            : undefined,
      metadata: this.toMetadata(d.metaData),
      gateway: this.name,
      raw: body,
    };
  }

  async hydrateWebhookMetadata(
    event: GatewayWebhookEvent,
  ): Promise<GatewayWebhookEvent> {
    // The renewal rejected processor hard-requires metadata ids and the
    // reference prefixes encode no row id — hydrate missing metadata from the
    // query API. Runs post-200 (deferred), so it never delays the ack.
    // Best-effort: on failure, keep the un-hydrated event (prefix routing
    // still works for the other lanes).
    if (
      event.type === 'other' ||
      (event.metadata && Object.keys(event.metadata).length > 0) ||
      !event.reference
    ) {
      return event;
    }
    try {
      const verification = await this.verifyPayment(event.reference);
      return { ...event, metadata: verification.metadata };
    } catch (error) {
      this.logger.warn(
        `Could not hydrate metadata for Monnify webhook ${event.reference}: ${(error as Error).message}`,
      );
      return event;
    }
  }

  allowedSourceIps(): string[] {
    return [...MONNIFY_IPS];
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  /** Monnify amounts are naira but may arrive as strings. NaN → 0 (the
   *  downstream amount guards then quarantine instead of mis-crediting). */
  private toNaira(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      if (value != null) {
        this.logger.warn(`Monnify amount not numeric: ${String(value)}`);
      }
      return 0;
    }
    return n;
  }

  private toChannel(paymentMethod: unknown): string {
    if (!paymentMethod) return '';
    const key = String(paymentMethod).toUpperCase();
    return CHANNEL_MAP[key] ?? String(paymentMethod).toLowerCase();
  }

  private toMetadata(metaData: unknown): Record<string, any> | null {
    if (!metaData) return null;
    if (typeof metaData === 'object') return metaData as Record<string, any>;
    if (typeof metaData === 'string') {
      try {
        const parsed = JSON.parse(metaData);
        return typeof parsed === 'object' && parsed !== null ? parsed : null;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Parse Monnify's two timestamp shapes as Africa/Lagos wall-clock (+01:00):
   *   A: "2026-07-15 10:23:45.123" / "2026-07-15 10:23:45"   (v2 webhooks)
   *   B: "15/7/2026 10:23:45 AM" (day-first, 12-hour, no leading zeros —
   *      query API + legacy webhooks)
   * Returns null (never Invalid Date) on null/unrecognized input — verify
   * responses legitimately carry paidOn:null for PENDING/FAILED.
   */
  private parseMonnifyDate(value: unknown): Date | null {
    if (!value || typeof value !== 'string') return null;
    const input = value.trim();

    // Format A: ISO-ish with a space separator.
    const isoLike = input.match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/,
    );
    if (isoLike) {
      const [, y, mo, da, h, mi, s, ms] = isoLike;
      const date = new Date(
        `${y}-${mo}-${da}T${h}:${mi}:${s}.${(ms ?? '0').padEnd(3, '0')}+01:00`,
      );
      return Number.isNaN(date.getTime()) ? null : date;
    }

    // Format B: day-first 12-hour clock.
    const dayFirst = input.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T](\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)$/i,
    );
    if (dayFirst) {
      const [, da, mo, y, hRaw, mi, s, meridiem] = dayFirst;
      let hour = Number(hRaw) % 12;
      if (meridiem.toUpperCase() === 'PM') hour += 12;
      const pad = (v: number | string) => String(v).padStart(2, '0');
      const date = new Date(
        `${y}-${pad(mo)}-${pad(da)}T${pad(hour)}:${mi}:${s}+01:00`,
      );
      return Number.isNaN(date.getTime()) ? null : date;
    }

    this.logger.warn(`Unrecognized Monnify date format: "${input}"`);
    return null;
  }

  private looksLikeNotFound(message: string | undefined): boolean {
    return /not\s*found|does\s*not\s*exist|invalid\s*transaction\s*reference/i.test(
      message ?? '',
    );
  }

  /** 4xx init failures: duplicate reference → typed error; else pass through. */
  private toTypedInitError(error: any, reference: string): any {
    const responseData = (error as AxiosError)?.response?.data as
      | MonnifyEnvelope<unknown>
      | undefined;
    const status = (error as AxiosError)?.response?.status;
    if (
      status &&
      status >= 400 &&
      status < 500 &&
      responseData?.requestSuccessful === false &&
      /duplicate/i.test(responseData?.responseMessage ?? '')
    ) {
      return new DuplicateReferenceError(
        reference,
        responseData.responseMessage,
      );
    }
    return error;
  }

  /** 4xx verify failures: definitive not-found → typed error; transients and
   *  auth failures pass through untouched (never fake a not-found). Keying on
   *  HTTP 404 (a real signal on query-by-reference) makes the legacy-Paystack
   *  fallback fire reliably during cutover without depending solely on the
   *  responseMessage wording — capture the exact sandbox responseCode and add
   *  it here to harden further (see MONNIFY_ROLLOUT.md). */
  private toTypedVerifyError(error: any, reference: string): any {
    const responseData = (error as AxiosError)?.response?.data as
      | MonnifyEnvelope<unknown>
      | undefined;
    const status = (error as AxiosError)?.response?.status;
    const isNotFound =
      status === 404 ||
      (!!status &&
        status >= 400 &&
        status < 500 &&
        status !== 401 &&
        status !== 403 &&
        this.looksLikeNotFound(responseData?.responseMessage));
    if (isNotFound) {
      return new GatewayReferenceNotFoundError(
        reference,
        responseData?.responseMessage,
      );
    }
    return error;
  }
}
