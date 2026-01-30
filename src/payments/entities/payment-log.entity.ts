import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Payment } from './payment.entity';

export enum PaymentLogEventType {
  WEBHOOK = 'webhook',
  POLLING = 'polling',
  INITIATION = 'initiation',
  VERIFICATION = 'verification',
  ERROR = 'error',
}

@Entity('payment_logs')
@Index(['payment_id'])
@Index(['event_type'])
@Index(['created_at'])
export class PaymentLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  payment_id: string | null;

  @ManyToOne(() => Payment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment: Payment;

  @Column({
    type: 'varchar',
    length: 50,
    enum: PaymentLogEventType,
  })
  event_type: PaymentLogEventType;

  @Column({ type: 'jsonb' })
  event_data: Record<string, any>;

  @CreateDateColumn()
  created_at: Date;
}
