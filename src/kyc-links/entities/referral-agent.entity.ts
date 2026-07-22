import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../../base.entity';

/**
 * A referral agent, identified by PHONE NUMBER.
 *
 * `kyc_applications` remains the source of truth for referral facts (who referred whom,
 * every name typed, counts). This table stores only what can't be derived:
 *
 *  - `first_seen_name`: WRITE-ONCE. The first name ever recorded for this number. A later
 *    application can never be earlier than the first, so this never changes — the write is
 *    `ON CONFLICT DO NOTHING` with no update path, so there's nothing to drift.
 *  - `official_name`: an admin's override; exists nowhere else.
 *
 * Display name is always `official_name ?? first_seen_name`.
 */
@Entity({ name: 'referral_agents' })
export class ReferralAgent extends BaseEntity {
  /**
   * Normalised E.164 digits, matching `kyc_applications.referral_agent_phone_number`
   * byte-for-byte (that column is normalised at write time by @NormalizePhoneNumber()).
   */
  @Column({ type: 'varchar', unique: true })
  phone: string;

  /** First name ever seen for this phone. Immutable once written. */
  @Column({ type: 'varchar' })
  first_seen_name: string;

  /** Admin-assigned official name. Null until someone renames the agent. */
  @Column({ type: 'varchar', nullable: true })
  official_name?: string | null;

  /** Account.id of the admin who last set `official_name`. */
  @Column({ type: 'uuid', nullable: true })
  set_by?: string | null;

  @Column({ type: 'timestamp', nullable: true })
  set_at?: Date | null;
}
