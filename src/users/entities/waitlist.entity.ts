import { Column, Entity } from 'typeorm';
import { BaseEntity } from 'src/base.entity';

@Entity()
export class Waitlist extends BaseEntity {
  @Column({ nullable: false, type: 'varchar' })
  full_name: string;

  @Column({ nullable: false, type: 'varchar' })
  phone_number: string;

  @Column({ nullable: false, type: 'varchar' })
  option: string;

  @Column({ nullable: true, type: 'varchar' })
  referral_name: string;

  @Column({ nullable: true, type: 'varchar' })
  referral_phone_number: string;

  /** Why the person reached out — captured by the AI assistant. */
  @Column({ nullable: true, type: 'text' })
  reason: string;

  /** How the lead was captured: 'ai' (AI assistant) or 'buttons' (legacy menu). */
  @Column({ nullable: true, type: 'varchar' })
  source: string;

  /**
   * Set when the AI hands off to a human (user asked for one, or the per-phone
   * turn cap was hit). Surfaced to the team in the dashboard. Defaults false.
   */
  @Column({ nullable: false, type: 'boolean', default: false })
  needs_human: boolean;
}
