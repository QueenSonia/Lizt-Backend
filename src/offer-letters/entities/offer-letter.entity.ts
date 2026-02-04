import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Property } from '../../properties/entities/property.entity';
import { Account } from '../../users/entities/account.entity';
import { KYCApplication } from '../../kyc-links/entities/kyc-application.entity';

/**
 * Offer Letter Status Enum
 * Represents the current state of an offer letter
 */
export enum OfferLetterStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected',
  SELECTED = 'selected',
  REJECTED_BY_PAYMENT = 'rejected_by_payment',
  PAYMENT_HELD_RACE_CONDITION = 'payment_held_race_condition',
}

/**
 * Payment Status Enum
 * Represents the payment state of an offer letter
 */
export enum PaymentStatus {
  UNPAID = 'unpaid',
  PARTIAL = 'partial',
  FULLY_PAID = 'fully_paid',
}

/**
 * Terms of Tenancy Interface
 * Represents a single term/condition in the offer letter
 */
export interface TermsOfTenancy {
  title: string;
  content: string;
}

/**
 * OfferLetter Entity
 *
 * Stores formal offer letters sent to prospective tenants before
 * attaching them to a property. Contains all tenancy terms, fees,
 * and a unique token for public access.
 */
@Entity({ name: 'offer_letters' })
export class OfferLetter extends BaseEntity {
  @Column({ type: 'uuid' })
  kyc_application_id: string;

  @Column({ type: 'uuid' })
  property_id: string;

  @Column({ type: 'uuid' })
  landlord_id: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  rent_amount: number;

  @Column({ type: 'varchar', length: 20 })
  rent_frequency: string; // "Monthly" | "Quarterly" | "Bi-Annually" | "Annually"

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  service_charge?: number;

  @Column({ type: 'date' })
  tenancy_start_date: Date;

  @Column({ type: 'date' })
  tenancy_end_date: Date;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  caution_deposit?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  legal_fee?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  agency_fee?: number;

  @Column({
    type: 'enum',
    enum: OfferLetterStatus,
    default: OfferLetterStatus.PENDING,
  })
  status: OfferLetterStatus;

  @Column({ type: 'varchar', length: 64, unique: true })
  token: string;

  @Column({ type: 'jsonb' })
  terms_of_tenancy: TermsOfTenancy[];

  // Branding snapshot at time of creation
  @Column({ type: 'jsonb', nullable: true })
  branding?: {
    businessName: string;
    businessAddress: string;
    contactPhone: string;
    contactEmail: string;
    websiteLink: string;
    footerColor: string;
    letterhead?: string;
    signature?: string;
    headingFont: string;
    bodyFont: string;
  };

  // Payment-related fields (added in migration 1769400000000)
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  total_amount?: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  amount_paid: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  outstanding_balance?: number;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.UNPAID,
  })
  payment_status: PaymentStatus;

  @Column({ type: 'timestamp', nullable: true })
  selected_at?: Date;

  // PDF caching fields (added in migration 1738252800000)
  @Column({ type: 'text', nullable: true })
  pdf_url?: string;

  @Column({ type: 'timestamp', nullable: true })
  pdf_generated_at?: Date;

  // New field to store snapshot of all editable text content
  @Column({ type: 'jsonb', nullable: true })
  content_snapshot?: {
    offer_title: string;
    intro_text: string;
    agreement_text: string;
    closing_text: string;
    for_landlord_text: string;
    tenant_address: string;
    permitted_use: string;
    rent_amount_formatted?: string;
    service_charge_formatted?: string;
    caution_deposit_formatted?: string;
    legal_fee_formatted?: string;
    agency_fee_formatted?: string;
    tenancy_term?: string;
    tenancy_period?: string;
  };

  // Relations
  @ManyToOne(() => KYCApplication, { eager: false })
  @JoinColumn({ name: 'kyc_application_id' })
  kyc_application: KYCApplication;

  @ManyToOne(() => Property, { eager: false })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @ManyToOne(() => Account, { eager: false })
  @JoinColumn({ name: 'landlord_id' })
  landlord: Account;
}
