import { Entity, Column } from 'typeorm';
import { BaseEntity } from 'src/base.entity';

export enum WhatsAppNotificationStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

@Entity('whatsapp_notification_log')
export class WhatsAppNotificationLog extends BaseEntity {
  /** The WhatsApp template method name to call (e.g. "sendKYCApplicationNotification") */
  @Column()
  type: string;

  /** JSON payload passed to the template sender method */
  @Column({ type: 'jsonb' })
  payload: Record<string, any>;

  @Column({
    type: 'enum',
    enum: WhatsAppNotificationStatus,
    default: WhatsAppNotificationStatus.PENDING,
  })
  status: WhatsAppNotificationStatus;

  @Column({ default: 0 })
  attempts: number;

  @Column({ type: 'timestamp', nullable: true })
  last_attempted_at: Date | null;

  @Column({ type: 'text', nullable: true })
  last_error: string | null;

  /** Optional reference to the entity that triggered this notification */
  @Column({ type: 'uuid', nullable: true })
  reference_id: string | null;
}
