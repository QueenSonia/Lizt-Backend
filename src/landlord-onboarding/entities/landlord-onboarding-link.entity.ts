import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../base.entity';

/**
 * A stable, reusable public onboarding link owned by a single managing admin
 * (Property Kraft PM). Mirrors the `kyc_links` reuse-one-active-row pattern:
 * one active link per admin, shared freely. The token carries the admin
 * identity so every submission made through it is attributed to that admin
 * (its future `creator_id` when the submission is later approved).
 */
@Entity({ name: 'landlord_onboarding_links' })
export class LandlordOnboardingLink extends BaseEntity {
  @Index()
  @Column({ type: 'uuid', unique: true })
  token: string;

  // Account.id of the managing admin who generated this link.
  @Index()
  @Column({ type: 'uuid' })
  admin_id: string;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;
}
