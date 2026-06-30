import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  BeforeInsert,
} from 'typeorm';
import { Account } from '../../users/entities/account.entity';
import { Property } from '../../properties/entities/property.entity';
import { KYCApplication } from '../../kyc-links/entities/kyc-application.entity';
import { OfferLetter } from '../../offer-letters/entities/offer-letter.entity';
import { InvoiceLineItem } from './invoice-line-item.entity';
import { InvoicePayment } from './invoice-payment.entity';

export enum InvoiceStatus {
  PENDING = 'pending',
  PARTIALLY_PAID = 'partially_paid',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

@Entity('invoices')
export class Invoice {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 50, unique: true })
  invoice_number: string;

  @Column({ type: 'uuid' })
  landlord_id: string;

  // landlord_id is an Account.id (matches property.owner_id, offer_letters.landlord_id,
  // ad_hoc_invoices, renewal_invoices — the rest of the app keys identity on Account).
  @ManyToOne(() => Account, { nullable: false })
  @JoinColumn({ name: 'landlord_id' })
  landlord: Account;

  @Column({ type: 'uuid', nullable: true })
  tenant_id: string;

  // tenant_id is an Account.id. Display name/phone come from Account.user; in the
  // offer-letter flow tenant_id is left null and the tenant is shown via kyc_application.
  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Account;

  @Column({ type: 'uuid', nullable: true })
  kyc_application_id: string;

  @ManyToOne(() => KYCApplication, { nullable: true })
  @JoinColumn({ name: 'kyc_application_id' })
  kyc_application: KYCApplication;

  @Column({ type: 'uuid' })
  property_id: string;

  @ManyToOne(() => Property, { nullable: false })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @Column({ type: 'uuid', nullable: true })
  offer_letter_id: string;

  @ManyToOne(() => OfferLetter, { nullable: true })
  @JoinColumn({ name: 'offer_letter_id' })
  offer_letter: OfferLetter;

  @Column({ type: 'date', default: () => 'CURRENT_DATE' })
  invoice_date: Date;

  @Column({
    type: 'enum',
    enum: InvoiceStatus,
    default: InvoiceStatus.PENDING,
  })
  status: InvoiceStatus;

  @Column({ type: 'decimal', precision: 15, scale: 2 })
  total_amount: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  amount_paid: number;

  @Column({ type: 'decimal', precision: 15, scale: 2, default: 0 })
  outstanding_balance: number;

  @Column({
    type: 'decimal',
    precision: 15,
    scale: 2,
    nullable: true,
    default: 0,
  })
  credit_balance: number;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @OneToMany(() => InvoiceLineItem, (lineItem) => lineItem.invoice, {
    cascade: true,
  })
  line_items: InvoiceLineItem[];

  @OneToMany(() => InvoicePayment, (payment) => payment.invoice)
  payments: InvoicePayment[];

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @BeforeInsert()
  calculateOutstandingBalance() {
    this.outstanding_balance =
      Number(this.total_amount) - Number(this.amount_paid);
  }
}
