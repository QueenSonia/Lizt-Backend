import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../base.entity';

/**
 * Persisted record of how much of an installment payment was applied to a
 * specific covered source (FIFO waterfall). The per-source residual is derived
 * by summing these rows over PAID installments — there is deliberately NO
 * mutable residual column (a second source of truth would drift under the
 * webhook/verify race).
 *
 * FK columns are plain uuids (DB foreign keys live in the migration).
 */
@Entity({ name: 'payment_plan_allocations' })
@Index(['plan_id'])
@Index(['installment_id'])
@Index(['source_id'])
@Unique('uq_ppa_installment_source', ['installment_id', 'source_id'])
export class PaymentPlanAllocation extends BaseEntity {
  @Column({ type: 'uuid' })
  plan_id: string;

  @Column({ type: 'uuid' })
  installment_id: string;

  @Column({ type: 'uuid' })
  source_id: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;
}
