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

export enum ApplicationType {
  NEW_TENANT = 'new_tenant',
  PROPERTY_ADDITION = 'property_addition',
}

/**
 * KYC Application Entity
 *
 * All user-facing fields are required except additional_notes and parking_needs.
 * Employment-specific fields are nullable (conditionally required based on employment_status).
 */
@Entity({ name: 'kyc_applications' })
export class KYCApplication extends BaseEntity {
  @Column({ type: 'uuid' })
  kyc_link_id: string;

  @Column({ type: 'uuid' })
  property_id: string;

  @Column({ type: 'uuid' })
  initial_property_id: string;

  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    default: ApplicationStatus.PENDING,
  })
  status: ApplicationStatus;

  @Column({
    type: 'enum',
    enum: ApplicationType,
    default: ApplicationType.NEW_TENANT,
  })
  application_type: ApplicationType;

  @Column({ type: 'uuid', nullable: true })
  tenant_id?: string;

  // Personal Information
  @Column({ type: 'varchar' })
  first_name: string;

  @Column({ type: 'varchar' })
  last_name: string;

  @Column({ type: 'varchar' })
  email: string;

  @Column({ type: 'varchar' })
  contact_address: string;

  @Column({ type: 'varchar' })
  phone_number: string;

  @Column({ type: 'date' })
  date_of_birth: Date;

  @Column({ type: 'enum', enum: Gender })
  gender: Gender;

  @Column({ type: 'varchar' })
  nationality: string;

  @Column({ type: 'varchar' })
  state_of_origin: string;

  @Column({ type: 'enum', enum: MaritalStatus })
  marital_status: MaritalStatus;

  // Employment Information
  @Column({ type: 'enum', enum: EmploymentStatus })
  employment_status: EmploymentStatus;

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
  @Column({ type: 'varchar' })
  next_of_kin_full_name: string;

  @Column({ type: 'varchar' })
  next_of_kin_address: string;

  @Column({ type: 'varchar' })
  next_of_kin_relationship: string;

  @Column({ type: 'varchar' })
  next_of_kin_phone_number: string;

  @Column({ type: 'varchar' })
  next_of_kin_email: string;

  // Referral Agent Information (optional)
  @Column({ type: 'varchar', nullable: true })
  referral_agent_full_name?: string;

  @Column({ type: 'varchar', nullable: true })
  referral_agent_phone_number?: string;

  // Additional Personal Information
  @Column({ type: 'varchar' })
  religion: string;

  // Self-Employed Specific Fields (conditionally required)
  @Column({ type: 'varchar', nullable: true })
  nature_of_business?: string;

  @Column({ type: 'varchar', nullable: true })
  business_name?: string;

  @Column({ type: 'varchar', nullable: true })
  business_address?: string;

  @Column({ type: 'varchar', nullable: true })
  business_duration?: string;

  // Tenancy Information (optional for PROPERTY_ADDITION type)
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
  @Column({ type: 'varchar' })
  passport_photo_url: string;

  @Column({ type: 'varchar' })
  id_document_url: string;

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

  // Tracking fields
  @Column({ type: 'timestamp', nullable: true })
  form_opened_at?: Date;

  @Column({ type: 'varchar', nullable: true })
  form_opened_ip?: string;

  @Column({ type: 'timestamp', nullable: true })
  decision_made_at?: Date;

  @Column({ type: 'varchar', nullable: true })
  decision_made_ip?: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  user_agent?: string;

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
