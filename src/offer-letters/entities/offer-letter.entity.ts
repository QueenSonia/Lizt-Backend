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

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  caution_deposit: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  legal_fee: number;

  @Column({ type: 'varchar', length: 255 })
  agency_fee: string;

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
