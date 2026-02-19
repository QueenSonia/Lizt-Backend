import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Payment } from '../../payments/entities/payment.entity';
import { OfferLetter } from '../../offer-letters/entities/offer-letter.entity';
import { Property } from '../../properties/entities/property.entity';
import { KYCApplication } from '../../kyc-links/entities/kyc-application.entity';

@Entity({ name: 'receipts' })
@Index(['payment_id'])
@Index(['offer_letter_id'])
@Index(['property_id'])
@Index(['kyc_application_id'])
@Index(['token'])
export class Receipt extends BaseEntity {
  @Column({ type: 'varchar', length: 50, unique: true })
  receipt_number: string;

  @Column({ type: 'uuid' })
  payment_id: string;

  @Column({ type: 'uuid' })
  offer_letter_id: string;

  @Column({ type: 'uuid' })
  property_id: string;

  @Column({ type: 'uuid' })
  kyc_application_id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  token: string;

  @Column({ type: 'text', nullable: true })
  pdf_url: string | null;

  @Column({ type: 'date' })
  receipt_date: Date;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount_paid: number;

  @Column({ type: 'varchar', length: 50, nullable: true })
  payment_method: string | null;

  @Column({ type: 'varchar', length: 255 })
  payment_reference: string;

  @Column({ type: 'varchar', length: 255 })
  tenant_name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  tenant_email: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  tenant_phone: string | null;

  @Column({ type: 'varchar', length: 255 })
  property_name: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  property_address: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  invoice_number: string | null;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'jsonb', nullable: true })
  branding: Record<string, any> | null;

  // Relations
  @ManyToOne(() => Payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;

  @ManyToOne(() => OfferLetter, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_letter_id' })
  offer_letter: OfferLetter;

  @ManyToOne(() => Property, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @ManyToOne(() => KYCApplication, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'kyc_application_id' })
  kyc_application: KYCApplication;
}
