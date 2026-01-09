import {
  Entity,
  Column,
  CreateDateColumn,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Users } from '../../users/entities/user.entity';
import { MessageDirection } from './message-direction.enum';
import { MessageStatus } from './message-status.enum';

@Entity('chat_logs')
@Index(['phone_number'])
@Index(['created_at'])
@Index(['whatsapp_message_id'], {
  unique: true,
  where: 'whatsapp_message_id IS NOT NULL',
})
export class ChatLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', nullable: false })
  phone_number: string;

  @Column({ type: 'enum', enum: MessageDirection, nullable: false })
  direction: MessageDirection;

  @Column({ type: 'varchar', nullable: false })
  message_type: string;

  @Column({ type: 'text', nullable: true })
  content: string;

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, any>;

  @Column({ type: 'varchar', nullable: true, unique: true })
  whatsapp_message_id: string;

  @Column({
    type: 'enum',
    enum: MessageStatus,
    default: MessageStatus.SENT,
    nullable: false,
  })
  status: MessageStatus;

  @Column({ type: 'varchar', nullable: true })
  error_code: string;

  @Column({ type: 'text', nullable: true })
  error_reason: string;

  @CreateDateColumn()
  created_at: Date;

  @ManyToOne(() => Users, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  user: Users;

  @Column({ type: 'uuid', nullable: true })
  user_id: string;
}
