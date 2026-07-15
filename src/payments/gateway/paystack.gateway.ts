import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { PaystackService, PaystackVerifyResponse } from '../paystack.service';
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

// Paystack's official webhook source IP addresses (logging-only defense —
// see PaymentGateway.allowedSourceIps()).
const PAYSTACK_IPS = ['52.31.139.75', '52.49.173.169', '52.214.14.220'];

/**
 * Legacy adapter: wraps the existing PaystackService behind the neutral
 * PaymentGateway interface. After the Monnify flip it keeps serving verify +
 * webhook for historical/in-flight Paystack references (rows with
 * gateway='paystack'); no new payments initialize through it.
 *
 * Owns the naira↔kobo conversion — nothing outside this class multiplies or
 * divides by 100 for Paystack again.
 */
@Injectable()
export class PaystackGateway implements PaymentGateway {
  readonly name = 'paystack';
  /** Paystack access codes expire ~30 minutes after initialization. */
  readonly checkoutExpiryMinutes = 30;

  private readonly logger = new Logger(PaystackGateway.name);

  constructor(
    private readonly paystackService: PaystackService,
    private readonly configService: ConfigService,
  ) {}

  async initializePayment(
    params: InitializePaymentParams,
  ): Promise<InitializePaymentResult> {
    try {
      const res = await this.paystackService.initializeTransaction({
        email: params.email,
        amount: Math.round(params.amountNaira * 100), // naira → kobo
        reference: params.reference,
        callback_url: params.callbackUrl,
        metadata: params.metadata,
        channels: params.channels ?? ['card', 'bank_transfer'],
      });
      return {
        reference: params.reference,
        checkoutUrl: res.data.authorization_url,
        gatewayTransactionId: res.data.access_code,
        gateway: this.name,
      };
    } catch (error) {
      throw this.toTypedError(error, params.reference);
    }
  }

  async verifyPayment(reference: string): Promise<VerifyPaymentResult> {
    let res: PaystackVerifyResponse;
    try {
      res = await this.paystackService.verifyTransaction(reference);
    } catch (error) {
      throw this.toTypedError(error, reference);
    }

    const d = res.data;
    // Paystack statuses: success | failed | abandoned | reversed | ongoing |
    // pending | processing | queued. 'abandoned' can still complete, but by
    // the time anything acts on a normalized 'failed' (the 30-min cron age
    // gate / a stale-stash probe) treating it as failed matches the
    // pre-abstraction behavior; the webhook independently rescues a late
    // completion.
    const status: VerifyStatus =
      d.status === 'success'
        ? 'success'
        : d.status === 'failed' ||
            d.status === 'abandoned' ||
            d.status === 'reversed'
          ? 'failed'
          : 'pending';

    const paidAtRaw = d.paid_at || d.paidAt || null;
    return {
      status,
      rawStatus: d.status,
      moneyReceived: status === 'success',
      reference: d.reference,
      amountNaira: Number(d.amount) / 100, // kobo → naira
      channel: d.channel ?? '',
      paidAt: paidAtRaw ? new Date(paidAtRaw) : null,
      gatewayResponse: d.gateway_response,
      metadata: d.metadata ?? null,
      gateway: this.name,
      raw: res,
    };
  }

  verifyWebhookSignature(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
  ): boolean {
    const headerValue = headers['x-paystack-signature'];
    const signature = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    if (!signature) return false;

    const secretKey = this.configService.get<string>('PAYSTACK_SECRET_KEY');
    if (!secretKey) {
      // Legacy adapter without creds (post-retirement grace) — reject rather
      // than crash; the event is dropped and Paystack will retry/expire.
      this.logger.warn(
        'PAYSTACK_SECRET_KEY not configured — rejecting Paystack webhook',
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
    const eventType: string = body?.event ?? '';
    const d = body?.data ?? {};

    const type: GatewayWebhookEventType =
      eventType === 'charge.success'
        ? 'payment.success'
        : eventType === 'bank.transfer.rejected'
          ? 'transfer.rejected'
          : 'other';

    const paidAtRaw = d.paid_at || d.paidAt || null;
    return {
      type,
      rawEventType: eventType,
      reference: d.reference ?? '',
      amountNaira: Number(d.amount ?? 0) / 100, // kobo → naira
      channel: d.channel ?? '',
      paidAt: paidAtRaw ? new Date(paidAtRaw) : null,
      gatewayResponse: d.gateway_response,
      metadata: d.metadata ?? null,
      gateway: this.name,
      raw: body,
    };
  }

  async hydrateWebhookMetadata(
    event: GatewayWebhookEvent,
  ): Promise<GatewayWebhookEvent> {
    // Paystack webhooks always carry the metadata we set at init — nothing to
    // hydrate.
    return event;
  }

  allowedSourceIps(): string[] {
    return [...PAYSTACK_IPS];
  }

  /**
   * Map Paystack's error strings to the typed errors the callers key on
   * (`instanceof` checks in the cron's never_initiated branch and the
   * duplicate-reference retry loops). Everything else passes through
   * untouched so transient failures never masquerade as "not found".
   */
  private toTypedError(error: any, reference: string): any {
    const message: string =
      (typeof error?.getResponse === 'function'
        ? error.getResponse()?.message
        : undefined) ??
      error?.response?.data?.message ??
      error?.message ??
      '';
    const lower = String(message).toLowerCase();

    if (
      lower.includes('transaction reference not found') ||
      lower.includes('transaction_not_found')
    ) {
      return new GatewayReferenceNotFoundError(reference, message);
    }
    if (lower.includes('duplicate transaction reference')) {
      return new DuplicateReferenceError(reference, message);
    }
    return error;
  }
}
