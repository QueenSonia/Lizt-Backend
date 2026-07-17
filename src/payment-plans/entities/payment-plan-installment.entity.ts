import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { PaymentPlan } from './payment-plan.entity';

export enum InstallmentStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  PAID = 'paid',
}

export enum InstallmentPaymentMethod {
  /** Legacy rows only — paid online via Paystack before the gateway swap. */
  PAYSTACK = 'paystack',
  /** Paid online through the active payment gateway (channel unknown). */
  ONLINE = 'online',
  CASH = 'cash',
  TRANSFER = 'transfer',
  OTHER = 'other',
}

@Entity({ name: 'payment_plan_installments' })
@Index(['plan_id'])
@Index(['status'])
@Index(['due_date'])
// Explicit name (matching migration 1930) so synchronize() sees a no-op diff.
@Index('IDX_installments_gateway_reference', ['gateway_reference'])
export class PaymentPlanInstallment extends BaseEntity {
  @Column({ type: 'uuid' })
  plan_id: string;

  @ManyToOne(() => PaymentPlan, (plan) => plan.installments, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'plan_id' })
  plan: PaymentPlan;

  /** 1-based position within the plan. */
  @Column({ type: 'int' })
  sequence: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({ type: 'date' })
  due_date: Date;

  @Column({ type: 'varchar', length: 20, default: InstallmentStatus.PENDING })
  status: InstallmentStatus;

  @Column({ type: 'timestamp', nullable: true })
  paid_at: Date | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  amount_paid: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  payment_method: InstallmentPaymentMethod | null;

  /** Gateway payment reference if paid online, null for manual payments. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  gateway_reference: string | null;

  /** Which gateway took the online payment ('paystack' | 'monnify'), null for manual. */
  @Column({ type: 'varchar', length: 20, nullable: true })
  gateway: string | null;

  /** Free-form note for manual payments — e.g. "bank transfer from spouse". */
  @Column({ type: 'text', nullable: true })
  manual_payment_note: string | null;

  /** Audit trail — which landlord user marked the installment paid (manual). */
  @Column({ type: 'uuid', nullable: true })
  marked_paid_by_user_id: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  receipt_token: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  receipt_number: string | null;

  /**
   * Dedup key for the daily reminder cron: set to the date (UTC) the last
   * reminder fired so we skip sending more than once per day.
   */
  @Column({ type: 'date', nullable: true })
  last_reminder_sent_on: Date | null;
}
