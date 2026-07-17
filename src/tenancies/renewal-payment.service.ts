import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  RenewalInvoice,
  RenewalPaymentStatus,
  RenewalLetterStatus,
} from './entities/renewal-invoice.entity';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import { Property } from '../properties/entities/property.entity';
import {
  ACTIVE_PAYMENT_GATEWAY,
  DuplicateReferenceError,
  NormalizedPaymentEvent,
  PaymentGateway,
} from '../payments/gateway/payment-gateway.interface';
import { GatewayRegistryService } from '../payments/gateway/gateway-registry.service';
import { recordAmountMismatchArtifact } from '../payments/gateway/amount-mismatch-artifact';
import {
  attachIntentCheckout,
  discardPaymentIntent,
  recordPaymentIntent,
} from '../payments/gateway/payment-intent.helper';
import {
  PaymentIntent,
  PaymentIntentLane,
} from '../payments/entities/payment-intent.entity';
import { TenanciesService } from './tenancies.service';
import { NotificationService } from '../notifications/notification.service';
import { NotificationType } from '../notifications/enums/notification-type';
import { EventsGateway } from '../events/events.gateway';
import { WhatsAppNotificationLogService } from '../whatsapp-bot/whatsapp-notification-log.service';
import { TenantBalancesService } from '../tenant-balances/tenant-balances.service';
import { v4 as uuidv4 } from 'uuid';

export interface PaymentInitializationResult {
  reference: string;
  /** Hosted-checkout URL — the canonical field the frontend redirects to. */
  checkoutUrl: string;
  /**
   * @deprecated Legacy popup fields, populated only while the active gateway
   * is Paystack. Dropped in the legacy-retire pass once no open tenant tab
   * still runs the popup flow.
   */
  accessCode?: string;
  /** @deprecated Alias of checkoutUrl for not-yet-redeployed frontends. */
  authorizationUrl?: string;
}

export interface PaymentVerificationResult {
  status: 'success' | 'failed' | 'pending';
  reference: string;
  amount: number;
  paidAt?: string;
  channel?: string;
  receiptToken?: string;
  /**
   * The payment option THIS reference was initialized with, read back from the
   * gateway's round-tripped metadata. Callers MUST pass it to
   * processSuccessfulPayment rather than letting it re-read the mutable
   * `invoice.payment_option` column.
   */
  paymentOption?: string | null;
  whatsappDelivery?: {
    sent: boolean;
    messageId?: string;
    error?: string;
  };
}

@Injectable()
export class RenewalPaymentService {
  private readonly logger = new Logger(RenewalPaymentService.name);

  constructor(
    @InjectRepository(RenewalInvoice)
    private readonly renewalInvoiceRepository: Repository<RenewalInvoice>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    @InjectRepository(Property)
    private readonly propertyRepository: Repository<Property>,
    @InjectRepository(PaymentIntent)
    private readonly paymentIntentRepository: Repository<PaymentIntent>,
    @Inject(ACTIVE_PAYMENT_GATEWAY)
    private readonly gateway: PaymentGateway,
    private readonly gatewayRegistry: GatewayRegistryService,
    private readonly tenanciesService: TenanciesService,
    private readonly notificationService: NotificationService,
    private readonly eventsGateway: EventsGateway,
    private readonly whatsappNotificationLog: WhatsAppNotificationLogService,
    private readonly tenantBalancesService: TenantBalancesService,
  ) {}

  /**
   * Initialize Paystack payment for renewal invoice
   * Requirements: 5.1, 5.5
   */
  async initializePayment(
    token: string,
    email: string,
    amount: number,
    paymentOption?: string,
  ): Promise<PaymentInitializationResult> {
    this.logger.log(`Initializing payment for renewal invoice: ${token}`);

    // Find renewal invoice by token
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      relations: ['property', 'tenant', 'tenant.user', 'propertyTenant'],
    });

    if (!invoice) {
      throw new NotFoundException('Renewal invoice not found');
    }

    // Check if invoice is already paid
    if (invoice.payment_status === RenewalPaymentStatus.PAID) {
      throw new ConflictException('This invoice has already been paid');
    }

    // Same gating as getRenewalInvoice: only the current (non-superseded)
    // landlord-type invoice whose letter has been accepted may accept payment.
    const isLandlordInvoice = invoice.token_type === 'landlord';
    if (isLandlordInvoice && invoice.superseded_by_id) {
      throw new HttpException(
        'This invoice has been updated. Your landlord has sent you a revised offer letter — please open the latest link from your WhatsApp.',
        HttpStatus.GONE,
      );
    }
    if (
      isLandlordInvoice &&
      invoice.letter_status !== RenewalLetterStatus.ACCEPTED
    ) {
      throw new HttpException(
        "Your landlord's offer letter hasn't been accepted yet. Please open the renewal letter link sent to your WhatsApp and accept it before paying.",
        HttpStatus.FORBIDDEN,
      );
    }

    // Validate amount is positive
    const invoiceTotal = Number(invoice.total_amount);
    const amountPaidSoFar = Number(invoice.amount_paid ?? 0);
    const remaining = Math.max(0, invoiceTotal - amountPaidSoFar);
    if (amount <= 0) {
      throw new BadRequestException('Payment amount must be greater than 0');
    }

    // Plan-aware guard. An active wallet-backed plan (Outstanding Balance /
    // ad-hoc) collects part or all of the wallet OB via its installments, so
    // this OB invoice must never charge that planned slice too — else the same
    // debt is collected twice (renewal credit + plan installments). The stored
    // total can be stale (the post-plan-create re-fold is best-effort and the
    // pay screen doesn't recompute it), so re-sync the invoice then recompute
    // the chargeable OB from the wallet at pay time and refuse anything above
    // it. Mirrors refreshInvoiceTotals' OB branch + the WhatsApp "Pay OB" flow.
    if (
      invoice.token_type === 'tenant' &&
      Number(invoice.rent_amount || 0) === 0 &&
      invoice.property?.owner_id
    ) {
      try {
        await this.tenanciesService.refreshInvoiceTotals(
          invoice.tenant_id,
          invoice.property.owner_id,
        );
      } catch (err) {
        this.logger.warn(
          `OB pre-payment re-fold failed for ${token}: ${(err as Error)?.message}`,
        );
      }
      const chargeableOb = await this.computeChargeableOutstandingBalance(
        invoice.tenant_id,
        invoice.property.owner_id,
      );
      if (chargeableOb <= 0) {
        throw new ConflictException(
          'Your outstanding balance is being settled by a payment plan — pay your plan installments instead of this invoice.',
        );
      }
      if (amount > chargeableOb + 1) {
        throw new ConflictException(
          `Part of your outstanding balance is now on a payment plan. The amount due is ₦${chargeableOb.toLocaleString()}. Please reopen the payment link to pay the updated amount.`,
        );
      }
    }

    // Custom (partial) payments are only valid on rent renewals, and only
    // when the renewal start_date is more than 14 days away. Inside the
    // 14-day window, the floor becomes the *remaining* outstanding so the
    // renewal still closes on time — using `remaining` (not invoiceTotal)
    // so a tenant who has already paid partials isn't asked to pay the
    // full original total.
    //
    // OB invoices (tenant token, rent=0) must be paid in full — there's
    // no renewal-period structure to scaffold a partial payment around.
    const isOutstandingBalanceInvoice =
      invoice.token_type === 'tenant' && Number(invoice.rent_amount || 0) === 0;

    if (paymentOption === 'custom') {
      if (isOutstandingBalanceInvoice) {
        throw new BadRequestException(
          `Outstanding balance must be paid in full (₦${remaining.toLocaleString()}).`,
        );
      }

      const PARTIAL_PAYMENT_WINDOW_DAYS = 14;
      const startDate = new Date(invoice.start_date);
      const today = new Date();
      const msPerDay = 1000 * 60 * 60 * 24;
      const daysUntilStart = Math.floor(
        (startDate.getTime() - today.getTime()) / msPerDay,
      );

      if (daysUntilStart <= PARTIAL_PAYMENT_WINDOW_DAYS && amount < remaining) {
        throw new BadRequestException(
          `Renewal is due in ${daysUntilStart} day(s). Please pay at least ₦${remaining.toLocaleString()} to complete this renewal.`,
        );
      }
    }

    // Store payment option on the invoice for post-payment processing
    if (paymentOption) {
      invoice.payment_option = paymentOption;
      await this.renewalInvoiceRepository.save(invoice);
    }

    // Generate unique reference with retry logic for collision handling.
    // A duplicate can now surface from two places: our own UNIQUE(reference)
    // on payment_intents, and the GATEWAY (typed DuplicateReferenceError).
    const maxRetries = 3;
    let reference = '';
    let initResult: Awaited<
      ReturnType<PaymentGateway['initializePayment']>
    > | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      reference = `RENEWAL_${Date.now()}_${uuidv4().substring(0, 8)}`;

      // Built once and shared: the intent's copy must be IDENTICAL to what the
      // gateway echoes back, because the sweep falls back to it when a gateway
      // returns metadata empty. Two hand-maintained copies would drift.
      const gatewayMetadata = {
        renewal_invoice_id: invoice.id,
        property_id: invoice.property_id,
        tenant_id: invoice.tenant_id,
        tenant_name: `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`,
        property_name: invoice.property.name,
        payment_option: paymentOption || null,
      };

      // Durable record BEFORE the gateway call — a network timeout here can
      // leave a live transaction the tenant can pay, and without this row
      // nothing would ever reconcile it. See recordPaymentIntent.
      const intent = await recordPaymentIntent(this.paymentIntentRepository, {
        reference,
        gateway: this.gateway.name,
        lane: PaymentIntentLane.RENEWAL,
        amountNaira: amount,
        relatedEntityId: invoice.id,
        metadata: gatewayMetadata,
      });

      try {
        initResult = await this.gateway.initializePayment({
          amountNaira: amount,
          email,
          customerName:
            `${invoice.tenant?.user?.first_name ?? ''} ${invoice.tenant?.user?.last_name ?? ''}`.trim() ||
            undefined,
          reference,
          callbackUrl: `${process.env.FRONTEND_URL}/renewal-invoice/${token}`,
          metadata: gatewayMetadata,
          channels: ['card', 'bank_transfer'],
        });

        this.logger.log(
          `Payment initialized successfully for renewal invoice: ${token}, reference: ${reference}`,
        );

        await attachIntentCheckout(
          this.paymentIntentRepository,
          this.logger,
          intent.id,
          initResult,
        );

        // Success - break out of retry loop
        break;
      } catch (error) {
        if (
          error instanceof DuplicateReferenceError &&
          attempt < maxRetries - 1
        ) {
          this.logger.warn('Reference collision, retrying', {
            reference,
            attempt: attempt + 1,
          });
          // The reference already exists AT THE GATEWAY, so verifying it would
          // resolve someone else's transaction rather than 404. Leaving this
          // orphan behind is the one case that could credit a stranger's money
          // to this invoice.
          await discardPaymentIntent(
            this.paymentIntentRepository,
            this.logger,
            intent.id,
          );
          continue;
        }

        // Re-throw if not a duplicate error or max retries reached
        this.logger.error(
          `Failed to initialize payment for renewal invoice: ${token}`,
          error.stack,
        );
        throw error;
      }
    }

    if (!initResult) {
      throw new BadRequestException(
        'Failed to initialize payment after retries',
      );
    }

    // Log payment initiated event to property history
    try {
      const tenantName = `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`;
      await this.tenanciesService.logRenewalPaymentInitiated(
        invoice.id,
        invoice.property_id,
        invoice.tenant_id,
        tenantName,
        invoice.property.name,
      );
    } catch (error) {
      this.logger.error('Failed to log payment initiated event:', error);
    }

    return {
      reference: initResult.reference,
      checkoutUrl: initResult.checkoutUrl,
      // Legacy popup fields — only meaningful for Paystack; the redirect
      // frontend ignores them.
      ...(initResult.gateway === 'paystack'
        ? {
            accessCode: initResult.gatewayTransactionId ?? undefined,
            authorizationUrl: initResult.checkoutUrl,
          }
        : {}),
    };
  }

  /**
   * The slice of the tenant's wallet outstanding balance this OB invoice may
   * still charge: raw wallet OB minus what active wallet-backed plans
   * (Outstanding Balance / ad-hoc) will collect via their installments. Same
   * formula refreshInvoiceTotals' OB branch and the WhatsApp "Pay OB" flow use,
   * recomputed at pay time so a stale link can't charge a planned slice.
   */
  private async computeChargeableOutstandingBalance(
    tenantId: string,
    landlordId: string,
  ): Promise<number> {
    const balance = await this.tenantBalancesService.getBalance(
      tenantId,
      landlordId,
    );
    const rawOutstanding = balance < 0 ? -balance : 0;
    const claimedByPlans =
      await this.tenantBalancesService.sumActiveWalletBackedPlanClaims(
        tenantId,
        landlordId,
      );
    return Math.max(0, rawOutstanding - claimedByPlans);
  }

  /**
   * Verify payment with the gateway that issued the reference. Renewals
   * persist nothing at init, so the registry probes the active gateway first
   * and falls back through legacy adapters on a definitive not-found.
   * Requirements: 5.3
   */
  async verifyPayment(reference: string): Promise<PaymentVerificationResult> {
    this.logger.log(`Verifying payment with reference: ${reference}`);

    try {
      const verification =
        await this.gatewayRegistry.verifyByReference(reference);

      this.logger.log(
        `Gateway (${verification.gateway}) verification for ${reference}: ${verification.rawStatus} → ${verification.status}`,
      );

      if (verification.status === 'success') {
        // Generate receipt token for successful payments
        const receiptToken = `receipt_${Date.now()}_${uuidv4().substring(0, 8)}`;

        return {
          status: 'success',
          reference: verification.reference,
          amount: verification.amountNaira,
          paidAt: verification.paidAt?.toISOString(),
          channel: verification.channel,
          receiptToken,
          paymentOption:
            (verification.metadata?.payment_option as string | null) ?? null,
        };
      }

      // Money-safety: a pending verdict that carries money (Monnify
      // PARTIALLY_PAID / OVERPAID) is REAL money sitting at the gateway that
      // we deliberately do not credit — write a durable, landlord-visible ops
      // artifact rather than only logging. This is the highest-value lane
      // (a partial on a multi-million-naira renewal), so a log line someone
      // has to happen to read is not an acceptable signal.
      if (verification.moneyReceived) {
        await recordAmountMismatchArtifact(
          this.propertyHistoryRepository,
          this.logger,
          {
            reference: verification.reference,
            amountNaira: verification.amountNaira,
            rawStatus: verification.rawStatus,
            gateway: verification.gateway,
            metadata: verification.metadata,
            lane: 'renewal verify',
            relatedEntityId: verification.metadata?.renewal_invoice_id ?? null,
            relatedEntityType: 'renewal_invoice',
          },
        );
      }

      return {
        status: verification.status,
        reference: verification.reference,
        amount: verification.amountNaira,
      };
    } catch (error) {
      this.logger.error(
        `Error verifying payment with gateway: ${reference}`,
        error.stack,
      );
      throw new BadRequestException(
        'Failed to verify payment. Please contact support if amount was deducted.',
      );
    }
  }

  /**
   * Process successful payment and send WhatsApp receipt
   * Requirements: 5.3, 3.1-3.6, 6.1-6.5, 7.1-7.4, 8.1-8.5
   *
   * @param paymentOptionOverride The payment option THIS reference was
   *   initialized with. Pass it whenever the caller knows it (webhook/sweep
   *   read it back from the gateway metadata). `invoice.payment_option` is a
   *   mutable column that initializePayment overwrites on every attempt, so
   *   reading it at credit time attributes the LATEST attempt's option to an
   *   OLDER reference — see the warning on the fallback below.
   */
  async processSuccessfulPayment(
    token: string,
    reference: string,
    amount: number,
    receiptToken?: string,
    channel?: string,
    paymentOptionOverride?: string | null,
  ): Promise<void> {
    this.logger.log(
      `Processing successful payment for renewal invoice: ${token}, reference: ${reference}`,
    );

    // Store receipt token and read payment_option from invoice
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { token },
      relations: ['property'],
    });

    let paymentOption: string | null = null;

    if (invoice) {
      // Per-reference idempotency: with partial payments, status alone is
      // not enough — a PARTIAL invoice is still a valid target for further
      // payments. Replays of the same Paystack reference (webhook +
      // frontend-verify race) early-return so receipt_token / receipt_number
      // aren't overwritten and orphan a WhatsApp link already sent.
      const alreadyApplied = (invoice.payment_history ?? []).some(
        (p) => p.reference === reference,
      );
      if (alreadyApplied) {
        this.logger.log(
          `Renewal invoice ${token} already has payment ${reference}; skipping (idempotent)`,
        );
        return;
      }

      // Money-safety net (mirrors the ad-hoc `ad_hoc_invoice_payment_on_covered`
      // quarantine). An OB invoice's payable slice can shrink AFTER its link was
      // minted — a wallet-backed plan created in between now collects part/all
      // of the wallet OB. If this landed payment exceeds the plan-adjusted
      // chargeable OB (stale link, or a plan created between initialize and
      // verify/webhook), crediting it would double-collect against the plan's
      // installments. Log for ops to reconcile/refund and do NOT credit.
      const isOutstandingBalanceInvoice =
        invoice.token_type === 'tenant' &&
        Number(invoice.rent_amount || 0) === 0;
      const landlordId = invoice.property?.owner_id;
      if (isOutstandingBalanceInvoice && landlordId) {
        const chargeableOb = await this.computeChargeableOutstandingBalance(
          invoice.tenant_id,
          landlordId,
        );
        if (amount > chargeableOb + 1) {
          this.logger.warn(
            `Renewal OB payment ${reference} (₦${amount}) exceeds plan-adjusted chargeable OB (₦${chargeableOb}) for invoice ${invoice.id} — not credited.`,
          );
          await this.propertyHistoryRepository.save(
            this.propertyHistoryRepository.create({
              property_id: invoice.property_id,
              tenant_id: invoice.tenant_id,
              event_type: 'renewal_ob_payment_on_planned',
              event_description: `Payment of ₦${amount.toLocaleString()} received on the outstanding-balance link (ref ${reference}), but ₦${Math.max(0, amount - chargeableOb).toLocaleString()} of it is already being settled by an active payment plan. Funds NOT applied to the invoice; reconcile/refund manually.`,
              related_entity_id: invoice.id,
              related_entity_type: 'renewal_invoice',
              metadata: {
                reference,
                amount,
                chargeable_ob: chargeableOb,
              },
            }),
          );
          return;
        }
      }

      // Amount sanity guard (100x unit-bug detector): a single payment lane
      // must never land dramatically above what the invoice can still absorb.
      // Legit flows: partial payments are ≤ remaining; full payments equal
      // remaining. Anything above remaining+1 is either a unit bug in the
      // gateway adapter or a genuinely odd overpayment — both need ops eyes.
      const invoiceTotal = Number(invoice.total_amount);
      const remaining = Math.max(
        0,
        invoiceTotal - Number(invoice.amount_paid ?? 0),
      );
      if (amount > remaining + 1) {
        this.logger.warn(
          `Renewal payment ${reference}: ₦${amount.toLocaleString()} exceeds the remaining invoice balance ₦${remaining.toLocaleString()} (invoice ${invoice.id}) — surfacing for ops review before crediting`,
        );
        try {
          await this.propertyHistoryRepository.save(
            this.propertyHistoryRepository.create({
              property_id: invoice.property_id,
              tenant_id: invoice.tenant_id,
              event_type: 'renewal_payment_amount_mismatch',
              event_description: `Payment of ₦${amount.toLocaleString()} (ref ${reference}) exceeds the remaining balance of ₦${remaining.toLocaleString()} on this renewal invoice. Verify the charge on the gateway dashboard and reconcile the surplus.`,
              related_entity_id: invoice.id,
              related_entity_type: 'renewal_invoice',
              metadata: { reference, amount, remaining },
            }),
          );
        } catch (guardErr) {
          this.logger.error(
            'Failed to write amount-mismatch history entry',
            (guardErr as Error)?.message,
          );
        }
      }

      // Column-scoped update — never a whole-entity save here: the webhook
      // (setImmediate) and the redirect-return verify race, and a stale
      // entity save would clobber a payment_history entry the other caller
      // just committed inside markInvoiceAsPaid's locked transaction.
      //
      // receipt_token/receipt_number are written NO-CLOBBER (COALESCE): the
      // race-losing caller must not overwrite a token the winner already
      // minted and embedded in a WhatsApp receipt link, or that delivered
      // link would resolve to nothing. payment_method (channel) is free to
      // set — it's not link-bearing.
      if (receiptToken) {
        await this.renewalInvoiceRepository
          .createQueryBuilder()
          .update(RenewalInvoice)
          .set({
            receipt_token: () => 'COALESCE(receipt_token, :rt)',
            receipt_number: () => 'COALESCE(receipt_number, :rn)',
            ...(channel ? { payment_method: channel } : {}),
          })
          .where('id = :id', { id: invoice.id })
          .setParameters({ rt: receiptToken, rn: `RR-${Date.now()}` })
          .execute();
      } else if (channel) {
        await this.renewalInvoiceRepository.update(invoice.id, {
          payment_method: channel,
        });
      }
      // MONEY-SAFETY: prefer the option THIS reference was initialized with.
      // `invoice.payment_option` is overwritten by every initializePayment
      // call (see :213-216), so it reflects the tenant's LATEST attempt, not
      // this payment's. Crediting an old `custom` partial while the column
      // says `full` makes markInvoiceAsPaid's `paymentOption === 'full'`
      // short-circuit fire — flipping the invoice PAID (plus rent advance,
      // receipt and WhatsApp) for a fraction of its value. The column fallback
      // remains only for references initialized before the override existed.
      paymentOption = paymentOptionOverride ?? invoice.payment_option;
    }

    // Delegate to TenanciesService to handle invoice update, notifications, and history updates.
    // INVOICE_SUPERSEDED race: the landlord revised the letter between the
    // tenant initiating Paystack and verify/webhook landing here. The funds
    // are real — credit them to the wallet, log, and return cleanly so
    // Paystack doesn't retry-loop and the tenant doesn't see a hard error.
    try {
      await this.tenanciesService.markInvoiceAsPaid(
        token,
        reference,
        amount,
        paymentOption || undefined,
      );
    } catch (err) {
      const code = (err as { response?: { code?: string } })?.response?.code;
      const invoiceId = (err as { response?: { invoiceId?: string } })?.response
        ?.invoiceId;
      if (code === 'INVOICE_SUPERSEDED' && invoiceId) {
        this.logger.warn(
          `Renewal payment ${reference} landed on superseded invoice ${invoiceId}; crediting tenant wallet and skipping rent-advance.`,
        );
        await this.tenanciesService.creditOrphanedRenewalPayment({
          invoiceId,
          amount,
          paymentReference: reference,
          paymentMethod: channel,
        });
        return;
      }
      throw err;
    }

    this.logger.log(
      `Successfully processed payment for renewal invoice: ${token}`,
    );
  }

  /**
   * Process a successful renewal payment from a gateway webhook.
   * Consumes the normalized event (naira — adapters own unit conversion) and
   * looks up the renewal invoice from the round-tripped metadata.
   */
  async processWebhookPayment(event: NormalizedPaymentEvent): Promise<void> {
    const { reference, amountNaira, metadata } = event;
    const renewalInvoiceId = metadata?.renewal_invoice_id;

    if (!renewalInvoiceId) {
      this.logger.error('Webhook missing renewal_invoice_id in metadata', {
        reference,
      });
      throw new Error('Missing renewal_invoice_id in webhook metadata');
    }

    this.logger.log(
      `Processing webhook for renewal invoice: ${renewalInvoiceId}, reference: ${reference}`,
    );

    // Find invoice by ID to get the token
    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { id: renewalInvoiceId },
    });

    if (!invoice) {
      this.logger.error('Renewal invoice not found for webhook', {
        renewalInvoiceId,
        reference,
      });
      throw new Error(`Renewal invoice not found: ${renewalInvoiceId}`);
    }

    // Per-reference idempotency. Status alone is no longer sufficient now
    // that PARTIAL invoices accept further payments; key on the reference.
    const alreadyApplied = (invoice.payment_history ?? []).some(
      (p) => p.reference === reference,
    );
    if (alreadyApplied) {
      this.logger.log(
        'Renewal invoice already has this payment (webhook idempotency), skipping',
        { renewalInvoiceId, reference },
      );
      return;
    }

    const receiptToken = `receipt_${Date.now()}_${uuidv4().substring(0, 8)}`;
    await this.processSuccessfulPayment(
      invoice.token,
      reference,
      amountNaira,
      receiptToken,
      event.channel || undefined,
      // The option THIS reference was initialized with, round-tripped through
      // the gateway (stamped at :245). Without it, a late-settling payment is
      // credited under whatever option the tenant most recently *started* —
      // see processSuccessfulPayment's paymentOptionOverride.
      (metadata?.payment_option as string | null) ?? null,
    );
  }

  /**
   * Process a bank.transfer.rejected webhook event for renewal invoice payments.
   * Writes to property history, tenant history, landlord livefeed notification,
   * and emits a real-time WebSocket event. Invoice stays UNPAID (no status change needed).
   */
  async processWebhookTransferRejected(
    event: NormalizedPaymentEvent,
  ): Promise<void> {
    const reference = event.reference;
    const amountInNaira = event.amountNaira;
    const gatewayResponse = event.gatewayResponse || 'Rejected';
    const renewalInvoiceId = event.metadata?.renewal_invoice_id;

    this.logger.log(
      `Processing bank.transfer.rejected for renewal invoice: ${renewalInvoiceId}, reference: ${reference}`,
    );

    if (!renewalInvoiceId) {
      this.logger.error(
        'Missing renewal_invoice_id in bank.transfer.rejected metadata',
        { reference },
      );
      return;
    }

    const invoice = await this.renewalInvoiceRepository.findOne({
      where: { id: renewalInvoiceId },
      relations: ['property', 'tenant', 'tenant.user'],
    });

    if (!invoice) {
      this.logger.error(
        'Renewal invoice not found for rejected bank transfer',
        {
          renewalInvoiceId,
          reference,
        },
      );
      return;
    }

    // Already fully paid — nothing to mark failed
    if (invoice.payment_status === RenewalPaymentStatus.PAID) {
      this.logger.log(
        'Renewal invoice already paid, skipping bank transfer rejection',
        { renewalInvoiceId },
      );
      return;
    }

    // Idempotency. A redelivered rejection webhook must not duplicate the
    // tenant-visible history rows, the Live Feed notification and the
    // WebSocket event. Unlike the success lanes there is no status to
    // compare-and-swap against — a rejected invoice legitimately stays UNPAID
    // — so we dedupe on the reference stamped into the history row's
    // metadata below.
    //
    // NOTE: do NOT record rejections in invoice.payment_history. That array is
    // summed to derive amount_paid (see TenanciesService.markInvoiceAsPaid);
    // an entry there would corrupt the tenant's balance.
    const priorRejections = await this.propertyHistoryRepository.find({
      where: {
        related_entity_id: invoice.id,
        event_type: 'bank_transfer_rejected',
      },
    });
    if (
      priorRejections.some(
        (h) => (h.metadata as { reference?: string })?.reference === reference,
      )
    ) {
      this.logger.log(
        'Renewal transfer rejection already recorded for this reference; skipping (idempotent)',
        { renewalInvoiceId, reference },
      );
      return;
    }

    const propertyId = invoice.property_id;
    const propertyName = invoice.property?.name || 'Property';
    const landlordId = invoice.property?.owner_id;
    const tenantId = invoice.tenant_id;
    const tenantName = invoice.tenant?.user
      ? `${invoice.tenant.user.first_name} ${invoice.tenant.user.last_name}`
      : 'Tenant';
    const description = `Bank transfer of ₦${amountInNaira.toLocaleString()} from ${tenantName} for renewal of ${propertyName} was rejected`;
    // Carries the dedupe key for the guard above.
    const rejectionMetadata = {
      reference,
      amount: amountInNaira,
      gateway: event.gateway,
    };

    // Property history — shows in landlord property details history tab
    try {
      const propertyEntry = this.propertyHistoryRepository.create({
        property_id: propertyId,
        event_type: 'bank_transfer_rejected',
        event_description: description,
        related_entity_id: invoice.id,
        related_entity_type: 'renewal_invoice',
        metadata: rejectionMetadata,
      });
      await this.propertyHistoryRepository.save(propertyEntry);
    } catch (error) {
      this.logger.error(
        'Failed to create property history for rejected renewal transfer',
        { error: error.message },
      );
    }

    // Tenant history — shows in landlord tenant details history tab
    try {
      const tenantEntry = this.propertyHistoryRepository.create({
        property_id: propertyId,
        tenant_id: tenantId,
        event_type: 'bank_transfer_rejected',
        event_description: description,
        related_entity_id: invoice.id,
        related_entity_type: 'renewal_invoice',
        metadata: rejectionMetadata,
      });
      await this.propertyHistoryRepository.save(tenantEntry);
    } catch (error) {
      this.logger.error(
        'Failed to create tenant history for rejected renewal transfer',
        { error: error.message },
      );
    }

    // Landlord livefeed notification + real-time WebSocket event
    if (landlordId) {
      this.notificationService
        .create({
          date: new Date().toISOString(),
          type: NotificationType.PAYMENT_TRANSFER_REJECTED,
          description,
          status: 'Completed',
          property_id: propertyId,
          user_id: landlordId,
        })
        .then(() => {
          this.eventsGateway.emitPaymentFailed(landlordId, {
            propertyId,
            propertyName,
            applicantName: tenantName,
            amount: amountInNaira,
            reason: gatewayResponse,
          });
        })
        .catch((error) => {
          this.logger.error(
            'Failed to create bank transfer rejection notification for renewal',
            { reference, error: error.message },
          );
        });
    }
  }

  /**
   * Find renewal invoice by payment reference
   * Helper method for WhatsApp receipt delivery
   */
  private async findInvoiceByReference(
    reference: string,
  ): Promise<RenewalInvoice | null> {
    try {
      // First, try to find by payment_reference (if already processed)
      let invoice = await this.renewalInvoiceRepository.findOne({
        where: { payment_reference: reference },
        relations: ['property', 'tenant', 'tenant.user'],
      });

      if (invoice) {
        return invoice;
      }

      // If not found, ask the gateway for the transaction's metadata to find
      // the invoice ID.
      const verification =
        await this.gatewayRegistry.verifyByReference(reference);
      const renewalInvoiceId = verification.metadata?.renewal_invoice_id;

      if (renewalInvoiceId) {
        invoice = await this.renewalInvoiceRepository.findOne({
          where: { id: renewalInvoiceId },
          relations: ['property', 'tenant', 'tenant.user'],
        });
      }

      return invoice;
    } catch (error) {
      this.logger.error('Error finding invoice by reference:', error);
      return null;
    }
  }
}
