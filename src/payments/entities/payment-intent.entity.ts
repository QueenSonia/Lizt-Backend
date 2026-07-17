import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Which flow minted the reference. Set at init — where we know it for certain —
 * so the sweep never has to re-derive it by sniffing reference prefixes.
 * Values match the `paymentType` strings the webhook router already logs
 * (webhooks.controller.ts) so the two paths are greppable together.
 *
 * `offer_letter` is absent on purpose: that lane has its own durable row in
 * `payments` and its own sweep (`checkExpiredPayments`).
 */
export enum PaymentIntentLane {
  RENEWAL = 'renewal',
  AD_HOC_INVOICE = 'ad_hoc_invoice',
  PAYMENT_PLAN_INSTALLMENT = 'payment_plan_installment',
  PAYMENT_PLAN_PAYOFF = 'payment_plan_payoff',
}

export enum PaymentIntentStatus {
  /** Awaiting an outcome. The sweep re-verifies these. */
  PENDING = 'pending',
  /**
   * The gateway confirmed success AND we handed it to the lane's processor.
   *
   * NOTE: this is NOT a promise the money was credited. Every processor
   * returns void for both a real credit and a deliberate quarantine (e.g.
   * `renewal_ob_payment_on_planned`, `ad_hoc_invoice_payment_on_covered`), so
   * this row cannot tell them apart. Quarantined funds are surfaced by the
   * lane's own property-history artifact. Splitting this into
   * credited/quarantined needs the processors to return a typed result.
   */
  RESOLVED = 'resolved',
  /** Gateway says the payment failed, or never saw the reference at all. */
  FAILED = 'failed',
  /** Never paid and past the long-stop. */
  ABANDONED = 'abandoned',
  /** Verification or dispatch kept throwing; parked for a human. */
  ERROR = 'error',
}

/**
 * One row per checkout handed to a tenant, written BEFORE the gateway call.
 *
 * This exists because a payment has only two chances to be noticed — the
 * tenant's browser coming back, and the webhook — and both fail routinely
 * (closed tab, async bank transfer settling after the ~15s return poll, a
 * webhook that 401s). Without a durable reference there is no third chance and
 * the money is simply lost. See PaymentReconciliationService.
 *
 * Written before init (not after) because a network timeout on
 * initializePayment can leave a LIVE gateway transaction we'd otherwise have
 * no record of. The reverse order — what the offer-letter lane does at
 * payment.service.ts:147-177 — leaves exactly that window open.
 */
@Entity('payment_intents')
// Explicit names (matching migration 1931) so dev-boot synchronize() sees a
// no-op diff — auto-hashed index names would not match the migration's.
@Unique('UQ_payment_intents_reference', ['reference'])
@Index('IDX_payment_intents_status_created_at', ['status', 'created_at'])
@Index('IDX_payment_intents_related_entity_id', ['related_entity_id'])
export class PaymentIntent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Our merchant reference (RENEWAL_/INV_/PLAN_/PLANPAYOFF_ prefixed). */
  @Column({ type: 'varchar', length: 255 })
  reference: string;

  /**
   * The adapter that ISSUED this reference — never the env default. The sweep
   * verifies against this gateway directly; asking the registry to probe every
   * adapter costs an extra HTTP round-trip per row per pass.
   */
  @Column({ type: 'varchar', length: 20 })
  gateway: string;

  @Column({ type: 'varchar', length: 32 })
  lane: PaymentIntentLane;

  /**
   * What we asked the tenant to pay.
   *
   * ⚠️ The `number` type here is a LIE that TypeScript will not catch: postgres
   * `numeric` comes back from the driver as a STRING ("1200000.50" — verified
   * against dev). Always `Number(...)` it before arithmetic or comparison, or
   * `amount > x` silently compares strings. Declared `number` to match the
   * sibling `Payment.amount`, which has the same trap.
   */
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount_naira: number;

  @Column({
    type: 'varchar',
    length: 16,
    default: PaymentIntentStatus.PENDING,
  })
  status: PaymentIntentStatus;

  /**
   * The lane's target row (renewal invoice / ad-hoc invoice / installment /
   * plan). Polymorphic across four tables, so deliberately NO foreign key —
   * `lane` says which table it points into.
   */
  @Column({ type: 'uuid', nullable: true })
  related_entity_id: string | null;

  @Column({ type: 'text', nullable: true })
  checkout_url: string | null;

  /** Gateway-side handle (Monnify transactionReference / Paystack accessCode). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  gateway_transaction_id: string | null;

  /**
   * The EXACT metadata object passed to initializePayment. Load-bearing: the
   * lane processors route on `event.metadata` (renewal throws without
   * `renewal_invoice_id`), and a gateway can echo metadata back empty. This is
   * our own copy to fall back on.
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;

  /** Drives the sweep's backoff and the ERROR cutoff. */
  @Column({ type: 'int', default: 0 })
  verify_attempts: number;

  @Column({ type: 'timestamp', nullable: true })
  last_verified_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  resolved_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
