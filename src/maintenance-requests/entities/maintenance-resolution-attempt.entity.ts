import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { MaintenanceRequest } from './maintenance-request.entity';
import { Users } from '../../users/entities/user.entity';
import { Artisan } from '../../artisans/entities/artisan.entity';
import { JobCategoryEnum } from '../dto/job-category.enum';

export enum ResolutionAttemptOutcomeEnum {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  DENIED = 'denied',
  REOPENED = 'reopened',
  // Auto-closed by the confirmation-reminder cron: the tenant never responded
  // to the resolved-confirmation prompt after the capped number of reminders,
  // so the request was closed without an explicit confirm/deny. Distinct from
  // CONFIRMED (tenant said "fixed") so reporting can tell a genuine
  // confirmation apart from a no-response timeout.
  EXPIRED = 'expired',
}

@Entity({ name: 'maintenance_resolution_attempts' })
@Index(['maintenance_request_id', 'attempt_number'])
@Unique('uq_maintenance_resolution_attempts_request_number', [
  'maintenance_request_id',
  'attempt_number',
])
export class MaintenanceResolutionAttempt extends BaseEntity {
  @Column({ nullable: false, type: 'uuid' })
  maintenance_request_id: string;

  @ManyToOne(() => MaintenanceRequest, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'maintenance_request_id',
    referencedColumnName: 'id',
  })
  maintenanceRequest: MaintenanceRequest;

  @Column({ nullable: false, type: 'integer' })
  attempt_number: number;

  @Column({ nullable: false, type: 'timestamp' })
  resolution_date: Date;

  @Column({ nullable: false, type: 'varchar', length: 64 })
  resolution_category: JobCategoryEnum;

  @Column({ nullable: false, type: 'text' })
  resolution_summary: string;

  @Column({ nullable: true, type: 'integer' })
  resolution_cost_minor?: number | null;

  @Column({ nullable: true, type: 'uuid' })
  artisan_id?: string | null;

  @ManyToOne(() => Artisan, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'artisan_id', referencedColumnName: 'id' })
  artisan?: Artisan | null;

  @Column({ nullable: true, type: 'varchar' })
  artisan_name_snapshot?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  artisan_phone_snapshot?: string | null;

  // Nullable so backfilled rows (no historical actor) can exist; new rows
  // always carry both fields.
  @Column({ nullable: true, type: 'uuid' })
  resolved_by_user_id?: string | null;

  @ManyToOne(() => Users, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'resolved_by_user_id', referencedColumnName: 'id' })
  resolvedBy?: Users | null;

  // Snapshot so the card keeps rendering "Resolved by <name>" if the FM
  // account is later renamed or removed.
  @Column({ nullable: true, type: 'varchar' })
  resolved_by_name_snapshot?: string | null;

  @Column({
    nullable: false,
    type: 'enum',
    enum: ResolutionAttemptOutcomeEnum,
    default: ResolutionAttemptOutcomeEnum.PENDING,
  })
  outcome: ResolutionAttemptOutcomeEnum;

  @Column({ nullable: true, type: 'timestamp' })
  outcome_decided_at?: Date | null;

  @Column({ nullable: true, type: 'text' })
  tenant_denial_reason?: string | null;
}
