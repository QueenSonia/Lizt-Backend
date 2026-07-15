import {
  Controller,
  Post,
  Body,
  Headers,
  Req,
  HttpCode,
  HttpStatus,
  Ip,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { PaymentService } from './payment.service';
import { RenewalPaymentService } from '../tenancies/renewal-payment.service';
import { PaystackLogger } from './paystack-logger.service';
import { PaymentPlansService } from '../payment-plans/payment-plans.service';
import { AdHocInvoicesService } from '../ad-hoc-invoices/ad-hoc-invoices.service';
import { PropertyHistoryService } from '../property-history/property-history.service';
import { GatewayRegistryService } from './gateway/gateway-registry.service';
import {
  GatewayWebhookEvent,
  PaymentGateway,
} from './gateway/payment-gateway.interface';

/**
 * Webhook controller for payment-gateway notifications.
 *
 * One shared pipeline (IP note → HMAC signature → parse → route) serves every
 * gateway; each route is a one-liner binding a gateway name. Adding a new
 * gateway = registering its adapter + adding one route below.
 *
 * Routing is keyed on OUR reference prefixes (echoed back verbatim by every
 * gateway) with metadata ids as fallback — identical priority order to the
 * original Paystack-only controller:
 *   PLANPAYOFF_ → PLAN_ → INV_ → RENEWAL_ → offer-letter (fallback)
 *
 * Security note: the IP whitelist is logging-only defense-in-depth. main.ts
 * sets `trust proxy`, so req.ip derives from client-controllable
 * X-Forwarded-For — the HMAC signature check is the real guard.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly renewalPaymentService: RenewalPaymentService,
    private readonly paystackLogger: PaystackLogger,
    private readonly gatewayRegistry: GatewayRegistryService,
    private readonly paymentPlansService: PaymentPlansService,
    private readonly adHocInvoicesService: AdHocInvoicesService,
    private readonly propertyHistoryService: PropertyHistoryService,
  ) {}

  @Public()
  @Post('paystack')
  @HttpCode(HttpStatus.OK)
  async handlePaystackWebhook(
    @Req() req: any,
    @Headers('x-paystack-signature') signature: string,
    @Body() body: any,
    @Ip() ip: string,
  ): Promise<{ status: string; message?: string }> {
    return this.handle('paystack', req, body, ip, {
      'x-paystack-signature': signature,
    });
  }

  @Public()
  @Post('monnify')
  @HttpCode(HttpStatus.OK)
  async handleMonnifyWebhook(
    @Req() req: any,
    @Headers('monnify-signature') signature: string,
    @Body() body: any,
    @Ip() ip: string,
  ): Promise<{ status: string; message?: string }> {
    return this.handle('monnify', req, body, ip, {
      'monnify-signature': signature,
    });
  }

  /**
   * Shared gateway-neutral webhook pipeline. Responds 200 fast and defers all
   * heavy work via setImmediate so gateways never retry on our processing
   * latency; idempotency lives in the processors (CAS / payment_history /
   * row locks).
   */
  private async handle(
    gatewayName: string,
    req: any,
    body: any,
    ip: string,
    explicitHeaders: Record<string, string | undefined>,
  ): Promise<{ status: string; message?: string }> {
    try {
      let adapter: PaymentGateway;
      try {
        adapter = this.gatewayRegistry.get(gatewayName);
      } catch {
        this.paystackLogger.error('Webhook for unregistered gateway', {
          gateway: gatewayName,
        });
        return { status: 'error', message: 'Unknown gateway' };
      }

      // 1. IP whitelist — LOGGING ONLY. It must NOT drop the event: req.ip is
      //    derived from a client-controllable X-Forwarded-For (main.ts sets
      //    trust proxy), so the check has no security value, and gateway
      //    egress IPs drift (Monnify publishes a single /32 that can change) —
      //    dropping on mismatch would silently lose a real payment webhook,
      //    the sole confirmation path for async bank transfers. The HMAC
      //    signature below is the real guard.
      const allowedIps = adapter.allowedSourceIps();
      if (allowedIps.length > 0 && !allowedIps.includes(ip)) {
        this.paystackLogger.warn('Webhook from unlisted source IP (allowed)', {
          gateway: gatewayName,
          detected_ip: ip,
          event: body?.event ?? body?.eventType,
        });
      }

      // 2. Signature validation over the RAW body (rawBody: true in main.ts).
      //    Header params are merged over req.headers so unit tests that pass
      //    the signature separately behave like real requests.
      const rawBody = req.rawBody
        ? req.rawBody.toString('utf8')
        : body
          ? JSON.stringify(body)
          : '';
      const headers = { ...(req.headers ?? {}), ...explicitHeaders };

      if (!adapter.verifyWebhookSignature(rawBody, headers)) {
        this.paystackLogger.error('Invalid webhook signature detected', {
          gateway: gatewayName,
          event: body?.event ?? body?.eventType,
          reference: body?.data?.reference ?? body?.eventData?.paymentReference,
        });
        return { status: 'error', message: 'Invalid signature' };
      }

      // 3. Normalize (shape-only, fast) + route. All heavy work — including
      //    any metadata hydration network call — is deferred past the 200 so
      //    the ack is never delayed and the gateway doesn't retry on our
      //    processing latency.
      const event = adapter.parseWebhookEvent(body);
      this.deferAndRoute(adapter, event);

      return { status: 'success' };
    } catch (error) {
      this.paystackLogger.error('Webhook endpoint error', {
        gateway: gatewayName,
        error: error.message,
        stack: error.stack,
      });
      return { status: 'error', message: error.message };
    }
  }

  /**
   * Defer everything past the 200: hydrate missing metadata (network call for
   * Monnify rejected events), then route. A single setImmediate wraps the
   * whole thing so the ack returns immediately and hydration never blocks it.
   */
  private deferAndRoute(
    adapter: PaymentGateway,
    event: GatewayWebhookEvent,
  ): void {
    setImmediate(async () => {
      let hydrated = event;
      try {
        hydrated = await adapter.hydrateWebhookMetadata(event);
      } catch (error) {
        this.paystackLogger.error('Webhook metadata hydration failed', {
          reference: event.reference,
          error: (error as Error).message,
        });
      }
      this.routeEvent(hydrated);
    });
  }

  /**
   * Prefix/metadata routing — the priority chain of the original controller,
   * consuming normalized events. Already runs in the deferred path (see
   * deferAndRoute); each processor is invoked directly (fire-and-forget with
   * .then/.catch), no further setImmediate needed.
   */
  private routeEvent(event: GatewayWebhookEvent): void {
    const reference = event.reference;
    const metadata = event.metadata ?? {};

    if (event.type === 'payment.success') {
      const isPlanPayoff =
        reference?.startsWith('PLANPAYOFF_') ||
        !!metadata.payment_plan_payoff_id;
      const isPaymentPlan =
        !isPlanPayoff &&
        (reference?.startsWith('PLAN_') ||
          !!metadata.payment_plan_installment_id);
      const isAdHocInvoice =
        !isPlanPayoff &&
        !isPaymentPlan &&
        (reference?.startsWith('INV_') || !!metadata.ad_hoc_invoice_id);
      const isRenewalPayment =
        !isPlanPayoff &&
        !isPaymentPlan &&
        !isAdHocInvoice &&
        (reference?.startsWith('RENEWAL_') || metadata.renewal_invoice_id);

      const paymentType = isPlanPayoff
        ? 'payment_plan_payoff'
        : isPaymentPlan
          ? 'payment_plan_installment'
          : isAdHocInvoice
            ? 'ad_hoc_invoice'
            : isRenewalPayment
              ? 'renewal'
              : 'offer_letter';

      this.paystackLogger.info('Processing payment.success webhook', {
        reference,
        gateway: event.gateway,
        amount_naira: event.amountNaira,
        type: paymentType,
      });

      const processor = isPlanPayoff
        ? this.paymentPlansService.markPlanPaidOffFromWebhook(event)
        : isPaymentPlan
          ? this.paymentPlansService.markInstallmentPaidFromWebhook(event)
          : isAdHocInvoice
            ? this.adHocInvoicesService.markInvoicePaidFromWebhook(event)
            : isRenewalPayment
              ? this.renewalPaymentService.processWebhookPayment(event)
              : this.paymentService.processSuccessfulPayment(event);

      processor
        .then(() => {
          this.paystackLogger.info('Webhook processed successfully', {
            reference,
          });
        })
        .catch((error) => {
          this.paystackLogger.error('Error processing webhook', {
            reference,
            error: error.message,
          });
        });
    } else if (event.type === 'transfer.rejected') {
      const isRenewalPayment =
        reference?.startsWith('RENEWAL_') || metadata.renewal_invoice_id;
      const isPlanLane =
        reference?.startsWith('PLANPAYOFF_') ||
        reference?.startsWith('PLAN_') ||
        !!metadata.payment_plan_payoff_id ||
        !!metadata.payment_plan_installment_id;
      const isAdHocLane =
        reference?.startsWith('INV_') || !!metadata.ad_hoc_invoice_id;

      this.paystackLogger.info('Processing transfer.rejected webhook', {
        reference,
        gateway: event.gateway,
        amount_naira: event.amountNaira,
        gateway_response: event.gatewayResponse,
        type: isRenewalPayment
          ? 'renewal'
          : isPlanLane
            ? 'payment_plan'
            : isAdHocLane
              ? 'ad_hoc_invoice'
              : 'offer_letter',
      });

      const processor = isRenewalPayment
        ? this.renewalPaymentService.processWebhookTransferRejected(event)
        : isPlanLane || isAdHocLane
          ? // These lanes have no bespoke rejected processor — record an
            // ops-visible artifact instead of dead-ending in the
            // offer-letter processor's "Payment not found" log.
            this.recordRejectedPaymentOpsEvent(
              event,
              isPlanLane ? 'payment_plan' : 'ad_hoc_invoice',
            )
          : this.paymentService.processBankTransferRejected(event);

      processor
        .then(() => {
          this.paystackLogger.info(
            'Transfer rejection webhook processed successfully',
            { reference },
          );
        })
        .catch((error) => {
          this.paystackLogger.error(
            'Error processing transfer rejection webhook',
            { reference, error: error.message },
          );
        });
    } else if (event.type === 'payment.amount_mismatch') {
      // Money REACHED the gateway but not as a clean success (Monnify
      // PARTIALLY_PAID / OVERPAID). Never the silent log-only branch: write
      // an ops artifact so someone reconciles the funds.
      this.paystackLogger.error(
        'Amount-mismatch payment webhook — money received without clean success',
        {
          reference,
          gateway: event.gateway,
          raw_event: event.rawEventType,
          amount_naira: event.amountNaira,
          gateway_response: event.gatewayResponse,
        },
      );
      this.recordAmountMismatchOpsEvent(event).catch((error) => {
        this.paystackLogger.error('Failed to record amount-mismatch ops event', {
          reference,
          error: error.message,
        });
      });
    } else {
      this.paystackLogger.info('Webhook event received', {
        gateway: event.gateway,
        event: event.rawEventType,
      });
    }
  }

  /** Ops artifact for rejected payments on lanes without a bespoke handler.
   *  property_id normally arrives on the webhook (or is filled by
   *  hydrateWebhookMetadata in deferAndRoute); the no-property_id branch is a
   *  rare fallback and still emits a full-detail, retained ERROR log so the
   *  rejection is never silently lost. */
  private async recordRejectedPaymentOpsEvent(
    event: GatewayWebhookEvent,
    lane: 'payment_plan' | 'ad_hoc_invoice',
  ): Promise<void> {
    const metadata = event.metadata ?? {};
    const propertyId = metadata.property_id;
    if (!propertyId) {
      this.paystackLogger.error(
        'RECONCILE: gateway payment rejected but no property_id to attach an ops row — recorded in logs only',
        {
          reference: event.reference,
          lane,
          gateway: event.gateway,
          amount_naira: event.amountNaira,
          gateway_response: event.gatewayResponse,
        },
      );
      return;
    }
    await this.propertyHistoryService.createPropertyHistory({
      property_id: propertyId,
      tenant_id: metadata.tenant_id ?? null,
      event_type: 'bank_transfer_rejected',
      event_description: `Bank transfer of ₦${event.amountNaira.toLocaleString()} (ref ${event.reference}) was rejected by the payment gateway${event.gatewayResponse ? ` — ${event.gatewayResponse}` : ''}. No money was applied.`,
      related_entity_id:
        metadata.payment_plan_installment_id ??
        metadata.payment_plan_payoff_id ??
        metadata.ad_hoc_invoice_id ??
        null,
      related_entity_type: lane,
    });
  }

  /** Ops artifact for money-received-but-mismatched webhooks. */
  private async recordAmountMismatchOpsEvent(
    event: GatewayWebhookEvent,
  ): Promise<void> {
    const metadata = event.metadata ?? {};
    const propertyId = metadata.property_id;
    if (!propertyId) {
      // Still ops-visible via the error log above; nothing to attach it to.
      return;
    }
    await this.propertyHistoryService.createPropertyHistory({
      property_id: propertyId,
      tenant_id: metadata.tenant_id ?? null,
      event_type: 'payment_amount_mismatch',
      event_description: `Gateway reports ₦${event.amountNaira.toLocaleString()} received on reference ${event.reference} (${event.gatewayResponse || event.rawEventType}) — does not match the requested charge. Funds are at the gateway; verify on the dashboard and reconcile manually.`,
      related_entity_id:
        metadata.renewal_invoice_id ??
        metadata.payment_plan_installment_id ??
        metadata.payment_plan_payoff_id ??
        metadata.ad_hoc_invoice_id ??
        metadata.offer_letter_id ??
        null,
      related_entity_type: 'payment_reference',
    });
  }
}
