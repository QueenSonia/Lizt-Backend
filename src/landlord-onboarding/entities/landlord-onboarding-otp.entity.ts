import { Column, Entity, Index } from 'typeorm';
import { BaseEntity } from '../../base.entity';

/**
 * Phone-verification OTP for the onboarding wizard's "save & continue later"
 * flow. Mirrors `kyc_otp`: a 6-digit code tied to (phone, onboarding link
 * token), verified once, then swapped for a short-lived verification JWT that
 * authorizes draft save/load.
 */
@Entity({ name: 'landlord_onboarding_otp' })
export class LandlordOnboardingOtp extends BaseEntity {
  @Index()
  @Column({ type: 'varchar' })
  phone_number: string;

  @Column({ type: 'varchar' })
  otp_code: string;

  // The onboarding link token this OTP was issued against.
  @Index()
  @Column({ type: 'varchar' })
  token: string;

  @Column({ type: 'boolean', default: false })
  is_verified: boolean;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @Column({ type: 'timestamp' })
  expires_at: Date;
}
