import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Property } from '../../properties/entities/property.entity';
import { Account } from '../../users/entities/account.entity';
import { KYCLink } from './kyc-link.entity';
import {
  Gender,
  MaritalStatus,
  EmploymentStatus,
} from '../../tenant-kyc/entities/tenant-kyc.entity';
import { OfferLetter } from '../../offer-letters/entities/offer-letter.entity';

export enum ApplicationStatus {
  PENDING = 'pending',
  PENDING_COMPLETION = 'pending_completion',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

/**
 * KYC Application Entity
 *
 * NOTE: Most fields have been made nullable for relaxed validation.
 * Only first_name, last_name, and phone_number are required.
 * Fields can be made required again by removing nullable: true and running a migration.
 */
@Entity({ name: 'kyc_applications' })
export class KYCApplication extends BaseEntity {
  @Column({ type: 'uuid' })
  kyc_link_id: string;

  @Column({ type: 'uuid' })
  property_id: string;

  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    default: ApplicationStatus.PENDING,
  })
  status: ApplicationStatus;

  @Column({ type: 'uuid', nullable: true })
  tenant_id?: string;

  // Personal Information - Only names and phone are required for relaxed validation
  @Column({ type: 'varchar' })
  first_name: string;

  @Column({ type: 'varchar' })
  last_name: string;

  @Column({ type: 'varchar', nullable: true })
  email?: string;

  @Column({ type: 'varchar', nullable: true })
  contact_address?: string;

  @Column({ type: 'varchar' })
  phone_number: string;

  @Column({ type: 'date', nullable: true })
  date_of_birth?: Date;

  @Column({ type: 'enum', enum: Gender, nullable: true })
  gender?: Gender;

  @Column({ type: 'varchar', nullable: true })
  nationality?: string;

  @Column({ type: 'varchar', nullable: true })
  state_of_origin?: string;

  @Column({ type: 'enum', enum: MaritalStatus, nullable: true })
  marital_status?: MaritalStatus;

  // Employment Information - All made optional for relaxed validation
  @Column({ type: 'enum', enum: EmploymentStatus, nullable: true })
  employment_status?: EmploymentStatus;

  @Column({ type: 'varchar', nullable: true })
  occupation?: string;

  @Column({ type: 'varchar', nullable: true })
  job_title?: string;

  @Column({ type: 'varchar', nullable: true })
  employer_name?: string;

  @Column({ type: 'varchar', nullable: true })
  work_address?: string;

  @Column({ type: 'varchar', nullable: true })
  monthly_net_income?: string;

  @Column({ type: 'varchar', nullable: true })
  work_phone_number?: string;

  @Column({ type: 'varchar', nullable: true })
  length_of_employment?: string;

  // Next of Kin Information
  @Column({ type: 'varchar', nullable: true })
  next_of_kin_full_name?: string;

  @Column({ type: 'varchar', nullable: true })
  next_of_kin_address?: string;

  @Column({ type: 'varchar', nullable: true })
  next_of_kin_relationship?: string;

  @Column({ type: 'varchar', nullable: true })
  next_of_kin_phone_number?: string;

  @Column({ type: 'varchar', nullable: true })
  next_of_kin_email?: string;

  // Referral Agent Information
  @Column({ type: 'varchar', nullable: true })
  referral_agent_full_name?: string;

  @Column({ type: 'varchar', nullable: true })
  referral_agent_phone_number?: string;

  // Additional Personal Information
  @Column({ type: 'varchar', nullable: true })
  religion?: string;

  // Self-Employed Specific Fields
  @Column({ type: 'varchar', nullable: true })
  nature_of_business?: string;

  @Column({ type: 'varchar', nullable: true })
  business_name?: string;

  @Column({ type: 'varchar', nullable: true })
  business_address?: string;

  @Column({ type: 'varchar', nullable: true })
  business_duration?: string;

  // Tenancy Information
  @Column({ type: 'varchar', nullable: true })
  intended_use_of_property?: string;

  @Column({ type: 'varchar', nullable: true })
  number_of_occupants?: string;

  @Column({ type: 'varchar', nullable: true })
  parking_needs?: string;

  @Column({ type: 'varchar', nullable: true })
  proposed_rent_amount?: string;

  @Column({ type: 'varchar', nullable: true })
  rent_payment_frequency?: string;

  @Column({ type: 'text', nullable: true })
  additional_notes?: string;

  // Document URLs (from Cloudinary)
  @Column({ type: 'varchar', nullable: true })
  passport_photo_url?: string;

  @Column({ type: 'varchar', nullable: true })
  id_document_url?: string;

  @Column({ type: 'varchar', nullable: true })
  employment_proof_url?: string;

  @Column({ type: 'varchar', nullable: true })
  business_proof_url?: string;

  // Pending KYC ID (for tracking incomplete submissions)
  @Column({ type: 'varchar', nullable: true })
  pending_kyc_id?: string;

  // Available Property IDs (for tracking property options)
  @Column({ type: 'varchar', nullable: true })
  available_property_ids?: string;

  @ManyToOne(() => KYCLink, (kycLink) => kycLink.applications)
  @JoinColumn({ name: 'kyc_link_id' })
  kyc_link: KYCLink;

  @ManyToOne(() => Property, (property) => property.kyc_applications)
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Account;

  @OneToMany(() => OfferLetter, (offerLetter) => offerLetter.kyc_application)
  offer_letters: OfferLetter[];
}
