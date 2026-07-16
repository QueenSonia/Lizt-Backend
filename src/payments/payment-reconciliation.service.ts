import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  PaymentIntent,
  PaymentIntentLane,
  PaymentIntentStatus,
} from './entities/payment-intent.entity';
import {
  GatewayReferenceNotFoundError,
  NormalizedPaymentEvent,
  VerifyPaymentResult,
} from './gateway/payment-gateway.interface';
import { GatewayRegistryService } from './gateway/gateway-registry.service';
import { recordAmountMismatchArtifact } from './gateway/amount-mismatch-artifact';
import { PaystackLogger } from './paystack-logger.service';
import { PropertyHistory } from '../property-history/entities/property-history.entity';
import { RenewalPaymentService } from '../tenancies/renewal-payment.service';
import { AdHocInvoicesService } from '../ad-hoc-invoices/ad-hoc-invoices.service';
import { PaymentPlansService } from '../payment-plans/payment-plans.service';

/** Most rows per pass. Bounds gateway load; the remainder is picked up next
 *  pass (oldest first, so nothing starves). Capping is always logged. */
const BATCH_SIZE = 100;

/** No gateway may hold a checkout open forever. Past this, an unpaid intent is
 *  abandoned — EXCEPT one holding money, which is never auto-resolved. */
const LONG_STOP_MS = 24 * 60 * 60 * 1000;

/**
 * Park a row after this many CONSECUTIVE errors (verify threw, or the lane's
 * processor threw) rather than hammering the gateway forever.
 *
 * Counts errors ONLY — never ordinary "still pending" passes. A normally
 * abandoned checkout sits pending for 48 passes before the 24h long-stop, so a
 * counter that ticked on every pass would park it as ERROR after ~4 hours and
 * (via the sweep's own `verify_attempts` filter) stop reconciling it before it
 * could ever be classified. A successful verify resets the streak.
 */
const MAX_VERIFY_ATTEMPTS = 8;

/**
 * The safety net for every payment lane that isn't offer-letters.
 *
 * A tenant's payment has only two chances to be noticed: their browser coming
 * back (a ~15s poll — lost to a closed tab or a bank transfer that settles
 * slowly) and the gateway webhook (a single delivery path — on 2026-07-15 it
 * 401'd every sandbox delivery for a full day and nothing noticed). When both
 * miss, the gateway holds the money, our DB says UNPAID, and the tenant gets
 * reminders for rent they already paid.
 *
 * This sweep is the third chance. It is deliberately NOT a second credit
 * implementation: it verifies the reference and hands the result to the SAME
 * processor the webhook would have called. It is a webhook replayer. That works
 * with zero conversion because `VerifyPaymentResult extends
 * NormalizedPaymentEvent` and every processor consumes that shape — the same
 * trick `PaymentService.checkExpiredPayments` already uses for offer letters.
 *
 * Everything it dispatches to is idempotent on `reference`, so racing the
 * webhook or the tenant's browser is safe by construction.
 */
@Injectable()
export class PaymentReconciliationService {
  private readonly logger = new Logger(PaymentReconciliationService.name);

  constructor(
    @InjectRepository(PaymentIntent)
    private readonly intentRepository: Repository<PaymentIntent>,
    @InjectRepository(PropertyHistory)
    private readonly propertyHistoryRepository: Repository<PropertyHistory>,
    private readonly gatewayRegistry: GatewayRegistryService,
    private readonly paystackLogger: PaystackLogger,
    private readonly renewalPaymentService: RenewalPaymentService,
    private readonly adHocInvoicesService: AdHocInvoicesService,
    private readonly paymentPlansService: PaymentPlansService,
  ) {}

  /**
   * Same cadence as `PaymentService.checkExpiredPayments` on purpose: the two
   * sweeps then share one timer window. The cost that matters is gateway HTTP
   * calls (one per pending intent per pass), not the DB query — so halving the
   * frequency halves the load on Monnify. A 30-minute worst case is irrelevant
   * for a safety net; the webhook and browser-return still handle the fast path.
   */
  @Cron('*/30 * * * *')
  async reconcilePendingIntents(): Promise<void> {
    const now = Date.now();

    const pending = await this.intentRepository.find({
      where: {
        status: PaymentIntentStatus.PENDING,
        verify_attempts: LessThan(MAX_VERIFY_ATTEMPTS),
      },
      order: { created_at: 'ASC' },
      take: BATCH_SIZE + 1,
    });

    // Never truncate silently — a capped sweep that looks complete is how a
    // backlog hides.
    const capped = pending.length > BATCH_SIZE;
    const batch = capped ? pending.slice(0, BATCH_SIZE) : pending;
    if (capped) {
      this.paystackLogger.warn(
        'Payment reconciliation hit its batch cap; remainder deferred to the next pass',
        { batch_size: BATCH_SIZE },
      );
    }
    if (!batch.length) return;

    this.logger.log(`Reconciling ${batch.length} pending payment intent(s)`);

    for (const intent of batch) {
      try {
        await this.reconcileOne(intent, now);
      } catch (error) {
        // Per-row isolation: one bad intent must not stop the sweep.
        await this.noteError(intent, error as Error);
      }
    }
  }

  /**
   * Decide the fate of ONE intent. Branch order is load-bearing — see the
   * money-received branch.
   */
  private async reconcileOne(
    intent: PaymentIntent,
    now: number,
  ): Promise<void> {
    const ageMs = now - intent.created_at.getTime();

    let verification: VerifyPaymentResult;
    try {
      verification = await this.verifyIntent(intent);
    } catch (error) {
      if (error instanceof GatewayReferenceNotFoundError) {
        // No gateway has ever seen this reference: init failed after we wrote
        // the intent. Nothing was ever payable, so nothing can be lost.
        await this.resolve(
          intent,
          PaymentIntentStatus.FAILED,
          'never initiated on the gateway',
        );
        return;
      }
      throw error;
    }

    if (verification.status === 'success') {
      await this.dispatch(intent, verification);
      await this.resolve(
        intent,
        PaymentIntentStatus.RESOLVED,
        `credited via ${intent.lane}`,
      );
      return;
    }

    // MUST precede the long-stop below. Monnify maps PARTIALLY_PAID/OVERPAID to
    // status 'pending' WITH moneyReceived=true — real money sitting at the
    // gateway that we deliberately do not credit. Marking such a row abandoned
    // would bury it. Never auto-resolve it; make it someone's problem, loudly.
    if (verification.moneyReceived) {
      // Deduped on reference, so re-running every pass adds no rows.
      await recordAmountMismatchArtifact(
        this.propertyHistoryRepository,
        this.paystackLogger,
        {
          reference: verification.reference,
          amountNaira: verification.amountNaira,
          rawStatus: verification.rawStatus,
          gateway: verification.gateway,
          metadata: this.resolveMetadata(intent, verification),
          lane: `${intent.lane} reconciliation`,
          relatedEntityId: intent.related_entity_id,
          relatedEntityType: intent.lane,
          expectedNaira: Number(intent.amount_naira),
        },
      );

      // Left pending, this row would be re-verified on every pass for the life
      // of the table — a permanent, growing gateway load for a state only a
      // human can clear. Once past the long-stop, park it: the artifact above
      // is already the durable, landlord-visible signal.
      if (ageMs >= LONG_STOP_MS) {
        await this.park(
          intent,
          `gateway has held ₦${verification.amountNaira.toLocaleString()} as ${verification.rawStatus} for over 24h without a clean success`,
        );
      } else {
        await this.touch(intent);
      }
      return;
    }

    if (verification.status === 'failed') {
      await this.resolve(
        intent,
        PaymentIntentStatus.FAILED,
        `gateway reports ${verification.rawStatus}`,
      );
      return;
    }

    // Still genuinely pending. A live checkout can outlast our sweep interval
    // (Monnify's stays payable ~40 min), so failing it now would stamp a
    // failure on something the tenant can still pay.
    const checkoutWindowMs = this.checkoutWindowMs(intent);
    if (ageMs < checkoutWindowMs) {
      await this.touch(intent);
      return;
    }

    if (ageMs >= LONG_STOP_MS) {
      await this.resolve(
        intent,
        PaymentIntentStatus.ABANDONED,
        'still unpaid after 24h',
      );
      return;
    }

    // Between the checkout window and the long-stop: let it converge (Monnify
    // PENDING becomes EXPIRED on its own).
    await this.touch(intent);
  }

  /**
   * Verify against the adapter that ISSUED the reference. Only fall back to the
   * registry's cross-gateway probe when that adapter has definitively never
   * seen it (a mislabelled row, or a legacy Paystack reference during cutover).
   * Asking the registry first would cost an extra HTTP round-trip per orphan on
   * every pass, forever. Mirrors PaymentService.verifyRowWithGateway.
   */
  private async verifyIntent(
    intent: PaymentIntent,
  ): Promise<VerifyPaymentResult> {
    try {
      return await this.gatewayRegistry
        .get(intent.gateway)
        .verifyPayment(intent.reference);
    } catch (error) {
      if (!(error instanceof GatewayReferenceNotFoundError)) throw error;
      return this.gatewayRegistry.verifyByReference(intent.reference);
    }
  }

  /**
   * Hand the verified payment to the lane's own webhook processor.
   *
   * Dispatch on the STORED lane, never on the reference prefix: the lane was
   * recorded at init where it is known for certain, whereas prefix-sniffing is
   * a guess made after the fact.
   */
  private async dispatch(
    intent: PaymentIntent,
    verification: VerifyPaymentResult,
  ): Promise<void> {
    const event: NormalizedPaymentEvent = {
      ...verification,
      metadata: this.resolveMetadata(intent, verification),
    };

    switch (intent.lane) {
      case PaymentIntentLane.RENEWAL:
        return this.renewalPaymentService.processWebhookPayment(event);
      case PaymentIntentLane.AD_HOC_INVOICE:
        return this.adHocInvoicesService.markInvoicePaidFromWebhook(event);
      case PaymentIntentLane.PAYMENT_PLAN_INSTALLMENT:
        return this.paymentPlansService.markInstallmentPaidFromWebhook(event);
      case PaymentIntentLane.PAYMENT_PLAN_PAYOFF:
        return this.paymentPlansService.markPlanPaidOffFromWebhook(event);
      default:
        // An unknown lane means a writer added a lane without teaching the
        // sweep about it. Throw so the row lands in ERROR and is visible,
        // rather than silently never reconciling.
        throw new Error(
          `No reconciliation processor for lane "${intent.lane}"`,
        );
    }
  }

  /**
   * Prefer the gateway's round-tripped metadata (parity with the webhook path),
   * falling back to our own copy.
   *
   * The emptiness check is NOT cosmetic and `??` will not do: both adapters can
   * return metadata that is empty but TRUTHY — Monnify's `toMetadata` passes
   * `{}` straight through, and Paystack yields `[]` for an empty payload. `??`
   * only catches null/undefined, so `{}` would win and the processor would
   * throw for missing routing ids. Same guard Monnify's own hydration uses.
   */
  private resolveMetadata(
    intent: PaymentIntent,
    verification: VerifyPaymentResult,
  ): Record<string, any> | null {
    const fromGateway = verification.metadata;
    return fromGateway && Object.keys(fromGateway).length > 0
      ? fromGateway
      : intent.metadata;
  }

  /** How long this intent's checkout stays payable, per its own adapter. */
  private checkoutWindowMs(intent: PaymentIntent): number {
    try {
      return (
        this.gatewayRegistry.get(intent.gateway).checkoutExpiryMinutes *
        60 *
        1000
      );
    } catch {
      // Unknown/retired adapter — fall back to the longest window we ship.
      return 40 * 60 * 1000;
    }
  }

  /** Terminal outcome: stop sweeping this intent. */
  private async resolve(
    intent: PaymentIntent,
    status: PaymentIntentStatus,
    reason: string,
  ): Promise<void> {
    await this.intentRepository.update(intent.id, {
      status,
      resolved_at: new Date(),
      last_verified_at: new Date(),
      verify_attempts: 0,
    });
    this.paystackLogger.info('Payment intent resolved by reconciliation', {
      intent_id: intent.id,
      reference: intent.reference,
      lane: intent.lane,
      status,
      reason,
    });
  }

  /**
   * The gateway answered, but the answer isn't terminal yet (checkout still
   * payable, or awaiting expiry). Clear the error streak — we reached the
   * gateway fine — and try again next pass.
   */
  private async touch(intent: PaymentIntent): Promise<void> {
    await this.intentRepository.update(intent.id, {
      last_verified_at: new Date(),
      verify_attempts: 0,
    });
  }

  /**
   * Stop sweeping and hand to a human. Used for money we cannot resolve
   * automatically, and for intents whose error streak is exhausted.
   */
  private async park(intent: PaymentIntent, reason: string): Promise<void> {
    await this.intentRepository.update(intent.id, {
      status: PaymentIntentStatus.ERROR,
      last_verified_at: new Date(),
    });
    this.paystackLogger.error(
      'RECONCILE: payment intent parked for manual review',
      {
        intent_id: intent.id,
        reference: intent.reference,
        lane: intent.lane,
        gateway: intent.gateway,
        amount_naira: intent.amount_naira,
        reason,
      },
    );
  }

  /**
   * A pass that threw. Only these tick the counter — see MAX_VERIFY_ATTEMPTS.
   * At the cap the row parks so a permanently-broken intent (deleted plan,
   * unroutable metadata) stops burning gateway calls every 30 minutes forever.
   */
  private async noteError(intent: PaymentIntent, error: Error): Promise<void> {
    const attempts = intent.verify_attempts + 1;

    await this.intentRepository.update(intent.id, {
      verify_attempts: attempts,
      last_verified_at: new Date(),
    });

    this.paystackLogger.error('Error reconciling payment intent', {
      intent_id: intent.id,
      reference: intent.reference,
      lane: intent.lane,
      attempts,
      error: error.message,
    });

    if (attempts >= MAX_VERIFY_ATTEMPTS) {
      await this.park(
        intent,
        `verification failed ${attempts} consecutive times — last error: ${error.message}`,
      );
    }
  }
}
