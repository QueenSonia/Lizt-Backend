import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { LandlordOnboardingSubmission } from './landlord-onboarding-submission.entity';

export enum OnboardingOccupancyStatus {
  OCCUPIED = 'occupied',
  VACANT = 'vacant',
}

/**
 * One document the landlord uploaded for a property (tenancy agreement, tenant
 * ID, receipt, …). `url` is a Cloudinary URL validated with
 * `FileUploadService.isOwnedCloudinaryUrl` at submit time.
 */
export interface OnboardingDocument {
  name: string;
  url: string;
  size?: string;
}

/**
 * A single property within an onboarding submission. Tenant + tenancy columns
 * are only populated when `occupancy_status = occupied`. Kept flat (tenant
 * fields inline) so the later approval step can map each row straight onto a
 * property + Rent + tenant graph.
 */
@Entity({ name: 'landlord_onboarding_properties' })
export class LandlordOnboardingProperty extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  submission_id: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'text' })
  address: string;

  @Column({
    type: 'enum',
    enum: OnboardingOccupancyStatus,
  })
  occupancy_status: OnboardingOccupancyStatus;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  rent: string | null;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  service_charge: string | null;

  @Column({ type: 'varchar', nullable: true })
  tenant_first_name: string | null;

  @Column({ type: 'varchar', nullable: true })
  tenant_last_name: string | null;

  @Column({ type: 'varchar', nullable: true })
  tenant_phone: string | null;

  @Column({ type: 'varchar', nullable: true })
  tenant_email: string | null;

  // Annual | Bi-Annual | Quarterly | Monthly | Custom (free-text, matching the
  // app's string payment-frequency convention on `rents`).
  @Column({ type: 'varchar', nullable: true })
  tenancy_type: string | null;

  @Column({ type: 'varchar', nullable: true })
  custom_duration: string | null;

  @Column({ type: 'date', nullable: true })
  tenancy_start_date: string | null;

  @Column({ type: 'date', nullable: true })
  tenancy_end_date: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  documents: OnboardingDocument[];

  @ManyToOne(() => LandlordOnboardingSubmission, (s) => s.properties, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'submission_id' })
  submission: LandlordOnboardingSubmission;
}
