import { Column, Entity, Index, OneToMany, Unique } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { LandlordType } from '../../users/entities/account.entity';
import {
  LandlordOnboardingProperty,
  OnboardingDocument,
} from './landlord-onboarding-property.entity';

/**
 * Lifecycle of a landlord's self-service onboarding application. `draft` is an
 * in-progress, not-yet-submitted application (the merged former "draft"); a
 * submitted application starts at `pending`. `approved`/`rejected` land in a
 * later provisioning milestone, so the column already carries the full shape.
 */
export enum LandlordOnboardingStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * A landlord's onboarding application — one row per `(admin_id, landlord_phone)`
 * (unique). This single record is both the resumable draft and the submitted
 * application (drafts + submissions were merged):
 *   - `data` (jsonb) holds the full wizard state — the prefill source and the
 *     working copy, updated on every "save & continue later" and submit.
 *   - the normalized columns + `properties` rows are the snapshot of the LAST
 *     submit (null/empty while `status = draft`).
 * Attributed to the managing admin via `admin_id` (resolved from the link
 * token). No landlord/property/tenant/Rent records are created until a PM
 * approves it (deferred).
 */
@Entity({ name: 'landlord_onboarding_submissions' })
@Unique('UQ_landlord_onboarding_submissions_admin_phone', [
  'admin_id',
  'landlord_phone',
])
export class LandlordOnboardingSubmission extends BaseEntity {
  // Account.id of the managing admin who owns the link this came through.
  @Index()
  @Column({ type: 'uuid' })
  admin_id: string;

  // Nullable: a draft-only row carries the name inside `data` until first submit.
  @Column({ type: 'varchar', nullable: true })
  landlord_first_name: string | null;

  @Column({ type: 'varchar', nullable: true })
  landlord_last_name: string | null;

  // Normalized (e.g. 234XXXXXXXXXX) — phone is the landlord's identity here.
  @Column({ type: 'varchar' })
  landlord_phone: string;

  @Column({ type: 'varchar', nullable: true })
  country_code: string | null;

  @Column({
    type: 'enum',
    enum: LandlordOnboardingStatus,
    default: LandlordOnboardingStatus.DRAFT,
  })
  status: LandlordOnboardingStatus;

  // Null while the application is still a draft; set on first submit.
  @Column({ type: 'timestamp', nullable: true })
  submitted_at: Date | null;

  // ---- Full wizard state — prefill source of truth (backward-compatible). ----
  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, any> | null;

  // ---- Landlord details (populated on submit) ----
  @Column({ type: 'enum', enum: LandlordType, nullable: true })
  landlord_type: LandlordType | null;

  @Column({ type: 'varchar', nullable: true })
  email: string | null;

  @Column({ type: 'date', nullable: true })
  date_of_birth: string | null;

  @Column({ type: 'varchar', nullable: true })
  employment_status: string | null;

  @Column({ type: 'text', nullable: true })
  address: string | null;

  // Corporate landlords only — the company/entity name.
  @Column({ type: 'varchar', nullable: true })
  company_name: string | null;

  // Individual landlords only — means of ID (National ID, Passport, …).
  @Column({ type: 'varchar', nullable: true })
  id_type: string | null;

  // Individual: photo(s) of the ID. Corporate: CAC certificate document(s).
  @Column({ type: 'jsonb', default: () => "'[]'" })
  id_documents: OnboardingDocument[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  corporate_documents: OnboardingDocument[];

  // Selected scope-of-services keys + optional "Other" free-text.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  scope_services: string[];

  @Column({ type: 'varchar', nullable: true })
  scope_other: string | null;

  @OneToMany(
    () => LandlordOnboardingProperty,
    (property) => property.submission,
    { cascade: true },
  )
  properties: LandlordOnboardingProperty[];
}
