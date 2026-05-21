import { Account } from 'src/users/entities/account.entity';
import { BaseEntity } from 'src/base.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import {
  Entity,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';

export enum MessageSender {
  TENANT = 'tenant',
  REP = 'rep',
  SYSTEM = 'system',
  ADMIN = 'admin',
  LANDLORD = 'landlord',
  FACILITY_MANAGER = 'facility_manager',
}

export enum MessageType {
  TEXT = 'text',
  FILE = 'file',
  IMAGE = 'image',
  SYSTEM = 'system',
}

@Entity('chat_messages')
@Index(['maintenance_request_id', 'created_at'])
export class ChatMessage extends BaseEntity {
  @Column()
  maintenance_request_id: string;

  @Column({
    type: 'enum',
    enum: MessageSender,
  })
  sender: MessageSender;

  @Column({
    type: 'enum',
    enum: MessageType,
    default: MessageType.TEXT,
  })
  type: MessageType;

  @Column('text')
  content: string;

  @Column({ nullable: true })
  fileName: string;

  @Column({ nullable: true })
  fileUrl: string;

  @Column({ default: false })
  isRead: boolean;

  @Column({ nullable: true })
  senderName: string;

  // Account.id of the author. Populated for LANDLORD / FACILITY_MANAGER
  // messages so the frontend can right-align the viewer's own bubbles and the
  // notification fan-out can resolve "prior posters". Nullable for legacy
  // sender types (tenant/rep/system/admin) that pre-date this column.
  @Column({ type: 'uuid', nullable: true })
  sender_account_id: string | null;

  @ManyToOne(() => Account, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'sender_account_id', referencedColumnName: 'id' })
  senderAccount: Account | null;

  @ManyToOne(
    () => MaintenanceRequest,
    (maintenanceRequest) => maintenanceRequest.messages,
    {
      onDelete: 'CASCADE',
    },
  )
  @JoinColumn({
    name: 'maintenance_request_id',
    referencedColumnName: 'request_id',
  })
  maintenanceRequest: MaintenanceRequest;
}
