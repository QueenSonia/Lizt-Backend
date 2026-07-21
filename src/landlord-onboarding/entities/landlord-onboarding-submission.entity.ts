import { Column, Entity, Index, OneToMany } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { LandlordOnboardingProperty } from './landlord-onboarding-property.entity';

/**
 * Lifecycle of a landlord's self-service onboarding submission. Only `pending`
 * is produced in this milestone — `approved`/`rejected` land in a later
 * provisioning milestone, so the column already carries the full shape.
 */
export enum LandlordOnboardingStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * A landlord's completed onboarding submission: their contact details plus the
 * portfolio of properties they submitted. Attributed to the managing admin via
 * `admin_id` (resolved from the link token). No landlord/property/tenant/Rent
 * records are created until a PM approves it (deferred).
 */
@Entity({ name: 'landlord_onboarding_submissions' })
export class LandlordOnboardingSubmission extends BaseEntity {
  // Account.id of the managing admin who owns the link this came through.
  @Index()
  @Column({ type: 'uuid' })
  admin_id: string;

  @Column({ type: 'varchar' })
  landlord_first_name: string;

  @Column({ type: 'varchar' })
  landlord_last_name: string;

  // Normalized (e.g. 234XXXXXXXXXX) — phone is the landlord's identity here.
  @Column({ type: 'varchar' })
  landlord_phone: string;

  @Column({ type: 'varchar', nullable: true })
  country_code: string | null;

  @Column({
    type: 'enum',
    enum: LandlordOnboardingStatus,
    default: LandlordOnboardingStatus.PENDING,
  })
  status: LandlordOnboardingStatus;

  @Column({ type: 'timestamp', default: () => 'now()' })
  submitted_at: Date;

  @OneToMany(
    () => LandlordOnboardingProperty,
    (property) => property.submission,
    { cascade: true },
  )
  properties: LandlordOnboardingProperty[];
}
