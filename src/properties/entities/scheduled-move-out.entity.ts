import { Entity, Column } from 'typeorm';
import { BaseEntity } from 'src/base.entity';
import { MoveOutReasonEnum } from 'src/property-history/entities/property-history.entity';

/**
 * Lifecycle of a scheduled move-out.
 *  - CONFIRMED: active scheduled end — processed by the daily processor on/after
 *    effective_date. Produced by "deactivate renewal" (a lapse, move_out_reason
 *    = LEASE_ENDED), "end on a specific date" (a forced removal, any other
 *    reason), and the legacy future-date scheduler.
 *  - CANCELLED: landlord cancelled/reactivated. Kept for audit instead of
 *    deleting; also marked processed = true so every active lookup (which
 *    filters processed: false) ignores it.
 */
export enum ScheduledMoveOutStatus {
  CONFIRMED = 'confirmed',
  CANCELLED = 'cancelled',
}

@Entity({ name: 'scheduled_move_outs' })
export class ScheduledMoveOut extends BaseEntity {
  @Column({ nullable: false, type: 'uuid' })
  property_id: string;

  @Column({ nullable: false, type: 'uuid' })
  tenant_id: string;

  @Column({ nullable: false, type: 'date' })
  effective_date: Date;

  @Column({
    nullable: true,
    type: 'enum',
    enum: MoveOutReasonEnum,
  })
  move_out_reason?: string | null;

  @Column({ nullable: true, type: 'text' })
  owner_comment?: string | null;

  @Column({ nullable: true, type: 'text' })
  tenant_comment?: string | null;

  @Column({ nullable: false, type: 'boolean', default: false })
  processed: boolean;

  @Column({ nullable: true, type: 'timestamp' })
  processed_at?: Date | null;

  @Column({
    type: 'varchar',
    length: 32,
    default: ScheduledMoveOutStatus.CONFIRMED,
  })
  status: ScheduledMoveOutStatus;
}
