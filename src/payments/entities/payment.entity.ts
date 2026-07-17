import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
} from 'typeorm';
import { OfferLetter } from '../../offer-letters/entities/offer-letter.entity';
import { RenewalInvoice } from '../../tenancies/entities/renewal-invoice.entity';

export enum PaymentType {
  PARTIAL = 'partial',
  FULL = 'full',
}

export enum PaymentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REFUNDED = 'refunded',
}

export enum PaymentMethod {
  CARD = 'card',
  BANK_TRANSFER = 'bank_transfer',
}

@Entity('payments')
@Index(['offer_letter_id'])
@Index(['renewal_invoice_id'])
// Explicit names (matching migration 1930) so dev-boot synchronize() sees a
// no-op diff — auto-hash index names change when a column renames.
@Index('IDX_payments_gateway_reference', ['gateway_reference'])
@Unique('UQ_payments_gateway_reference', ['gateway_reference'])
@Index(['status'])
@Index(['created_at'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  offer_letter_id: string;

  @ManyToOne(() => OfferLetter, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'offer_letter_id' })
  offerLetter: OfferLetter;

  @Column({ type: 'uuid', nullable: true })
  renewal_invoice_id: string | null;

  @ManyToOne(() => RenewalInvoice, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'renewal_invoice_id' })
  renewalInvoice: RenewalInvoice | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: number;

  @Column({
    type: 'varchar',
    length: 20,
    enum: PaymentType,
  })
  payment_type: PaymentType;

  @Column({
    type: 'varchar',
    length: 20,
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column({
    type: 'varchar',
    length: 20,
    enum: PaymentMethod,
    nullable: true,
  })
  payment_method: PaymentMethod | null;

  /** Our merchant-side payment reference (LIZT_/RENEWAL_ prefixed). Unique. */
  @Column({ type: 'varchar', length: 255 })
  gateway_reference: string;

  /**
   * Gateway-side transaction handle: Paystack access_code / Monnify
   * transactionReference (contains pipes, e.g. "MNFY|12|...").
   */
  @Column({ type: 'varchar', length: 255, nullable: true })
  gateway_transaction_id: string | null;

  /** Hosted-checkout URL returned by the gateway at initialization. */
  @Column({ type: 'text', nullable: true })
  gateway_checkout_url: string | null;

  /**
   * Which gateway issued gateway_reference (adapter name, e.g. 'paystack' |
   * 'monnify'). NOT NULL and deliberately without a default — insert paths
   * must stamp it explicitly (see migration 1930).
   */
  @Column({ type: 'varchar', length: 20 })
  gateway: string;

  @Column({ type: 'timestamp', nullable: true })
  paid_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
