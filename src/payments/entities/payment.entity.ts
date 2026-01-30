import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { OfferLetter } from '../../offer-letters/entities/offer-letter.entity';

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
@Index(['paystack_reference'])
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

  @Column({ type: 'varchar', length: 255, unique: true })
  paystack_reference: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  paystack_access_code: string | null;

  @Column({ type: 'text', nullable: true })
  paystack_authorization_url: string | null;

  @Column({ type: 'timestamp', nullable: true })
  paid_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any> | null;
}
