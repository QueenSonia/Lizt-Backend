import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../base.entity';

export enum PaymentPlanSourceKind {
  AD_HOC_INVOICE = 'ad_hoc_invoice',
  ARREARS = 'arrears',
}

/**
 * The frozen snapshot of the charge-sources a wallet-backed (Outstanding
 * Balance / ad-hoc) plan covers, captured at plan creation. FIFO settlement
 * order is `due_seq` (lower = oldest due, settled first).
 *
 * Per-source residual is DERIVED, never stored:
 *   covered_amount − Σ(payment_plan_allocations.amount over PAID installments).
 *
 * FK columns are plain uuids (the DB foreign keys live in the migration) to
 * avoid an entity import cycle between payment_plans and ad_hoc_invoices.
 */
@Entity({ name: 'payment_plan_sources' })
@Index(['plan_id'])
@Index(['source_ad_hoc_invoice_id'])
export class PaymentPlanSource extends BaseEntity {
  @Column({ type: 'uuid' })
  plan_id: string;

  @Column({ type: 'varchar', length: 20 })
  source_kind: PaymentPlanSourceKind;

  /** Set when source_kind = 'ad_hoc_invoice'. */
  @Column({ type: 'uuid', nullable: true })
  source_ad_hoc_invoice_id: string | null;

  /** Set when source_kind = 'arrears' — 'arrears:<property_id>' (or 'arrears:global'). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  arrears_bucket_key: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  covered_amount: number;

  /** FIFO ordinal — lower is settled first (oldest due). */
  @Column({ type: 'int' })
  due_seq: number;
}
