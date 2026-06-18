import { Entity, Column } from 'typeorm';
import { BaseEntity } from 'src/base.entity';
import { MoveOutReasonEnum } from 'src/property-history/entities/property-history.entity';

/**
 * Lifecycle of a scheduled move-out.
 *  - CONFIRMED: ready to be processed by the daily processor on/after
 *    effective_date (this is the default; the legacy "schedule a future
 *    move-out" path produces these directly).
 *  - PENDING_TENANT_CONFIRMATION: created by the landlord's "deactivate
 *    renewal" action, but NOT acted on until the tenant accepts over WhatsApp.
 *    Pending rows are ignored by both the auto-end processor and the
 *    renewal/reminder cron gate.
 */
export enum ScheduledMoveOutStatus {
  PENDING_TENANT_CONFIRMATION = 'pending_tenant_confirmation',
  CONFIRMED = 'confirmed',
  // Terminal states kept for audit instead of deleting the row. Both are also
  // marked processed = true so every active lookup (which filters
  // processed: false) ignores them.
  DENIED = 'denied',
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
