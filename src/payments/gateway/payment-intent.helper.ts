import { Repository } from 'typeorm';
import {
  PaymentIntent,
  PaymentIntentLane,
  PaymentIntentStatus,
} from '../entities/payment-intent.entity';

/** Structural logger — satisfied by both Nest's Logger and PaystackLogger. */
interface IntentLogger {
  warn(message: string, ...meta: any[]): void;
}

export interface RecordPaymentIntentArgs {
  /** Our merchant reference — the gateway-side identity of this checkout. */
  reference: string;
  /** The adapter about to be called. Stamp `gateway.name`, never the env. */
  gateway: string;
  lane: PaymentIntentLane;
  amountNaira: number;
  /** The lane's target row (invoice / installment / plan). */
  relatedEntityId?: string | null;
  /** The EXACT object being passed to initializePayment — see the entity. */
  metadata?: Record<string, any> | null;
}

/**
 * Write the durable record of a checkout, BEFORE the gateway is called.
 *
 * Ordering is the whole point. Calling the gateway first and persisting after
 * (what the offer-letter lane does at payment.service.ts:147-177) leaves a
 * window where init succeeds, the insert fails, and the tenant is holding a
 * live checkout URL we have no record of — money we can never reconcile.
 * Inverting it makes the bad case a harmless orphan `pending` row.
 *
 * DELIBERATELY THROWS, unlike its sibling `recordAmountMismatchArtifact` which
 * swallows. That helper runs after money has already moved, so failing loudly
 * would break a payment path for the sake of an ops note. This one runs BEFORE
 * the tenant has any way to pay, so no money is in flight: refusing to hand out
 * a checkout we cannot track is strictly safer than handing out an untracked
 * one. A missing intent is a missing safety net.
 */
export async function recordPaymentIntent(
  repo: Repository<PaymentIntent>,
  args: RecordPaymentIntentArgs,
): Promise<PaymentIntent> {
  return repo.save(
    repo.create({
      reference: args.reference,
      gateway: args.gateway,
      lane: args.lane,
      amount_naira: args.amountNaira,
      status: PaymentIntentStatus.PENDING,
      related_entity_id: args.relatedEntityId ?? null,
      metadata: args.metadata ?? null,
    }),
  );
}

/**
 * Attach the gateway's own handles once init returns.
 *
 * Best-effort by design: the intent already carries everything the sweep needs
 * (reference + gateway + lane + metadata), so losing the checkout URL costs us
 * a debugging convenience, not a reconciliation. Never let it break a payment
 * the tenant is about to make.
 */
export async function attachIntentCheckout(
  repo: Repository<PaymentIntent>,
  logger: IntentLogger,
  intentId: string,
  init: { checkoutUrl?: string | null; gatewayTransactionId?: string | null },
): Promise<void> {
  try {
    await repo.update(intentId, {
      checkout_url: init.checkoutUrl ?? null,
      gateway_transaction_id: init.gatewayTransactionId ?? null,
    });
  } catch (err) {
    logger.warn(
      `Could not attach checkout details to payment intent ${intentId}: ${(err as Error).message}`,
    );
  }
}

/**
 * Drop an intent whose reference the gateway rejected as a duplicate.
 *
 * Subtle and load-bearing: DuplicateReferenceError means the reference ALREADY
 * EXISTS at the gateway. So verifying it would NOT 404 — it would resolve
 * somebody else's transaction, and the sweep would happily credit that money
 * to this intent's invoice. Deleting the orphan before retrying with a fresh
 * reference is the only thing standing between a collision and a mis-credit.
 *
 * (With `${Date.now()}_${uuid8}` references a real collision is essentially
 * impossible — this is cheap insurance on a cold path, not a hot concern.)
 */
export async function discardPaymentIntent(
  repo: Repository<PaymentIntent>,
  logger: IntentLogger,
  intentId: string,
): Promise<void> {
  try {
    await repo.delete(intentId);
  } catch (err) {
    logger.warn(
      `Could not discard orphaned payment intent ${intentId}: ${(err as Error).message}`,
    );
  }
}
