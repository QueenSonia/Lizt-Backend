import { Column, Entity, Index, Unique } from 'typeorm';
import { BaseEntity } from '../../base.entity';

/**
 * A server-side, resumable draft of an in-progress onboarding wizard. Keyed by
 * (admin, phone) so a landlord can resume from any device after re-verifying
 * their phone via OTP. `data` holds the whole wizard state, including the
 * Cloudinary URLs of already-uploaded documents (so resuming never re-uploads).
 * Cleared when the submission is finally submitted.
 */
@Entity({ name: 'landlord_onboarding_drafts' })
@Unique('UQ_landlord_onboarding_drafts_admin_phone', [
  'admin_id',
  'phone_number',
])
export class LandlordOnboardingDraft extends BaseEntity {
  @Index()
  @Column({ type: 'uuid' })
  admin_id: string;

  // Normalized phone (the draft owner's identity).
  @Column({ type: 'varchar' })
  phone_number: string;

  @Column({ type: 'jsonb' })
  data: Record<string, any>;
}
