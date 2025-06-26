import { BaseEntity } from 'src/base.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from 'typeorm';

export enum MessageSender {
  TENANT = 'tenant',
  REP = 'rep',
  SYSTEM = 'system',
  ADMIN = 'admin'
}

export enum MessageType {
  TEXT = 'text',
  FILE = 'file',
  IMAGE = 'image',
  SYSTEM = 'system'
}

@Entity('chat_messages')
export class ChatMessage extends BaseEntity {
  @Column()
  service_request_id: string;

  @Column({
    type: 'enum',
    enum: MessageSender
  })
  sender: MessageSender;

  @Column({
    type: 'enum',
    enum: MessageType,
    default: MessageType.TEXT
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

  @ManyToOne(() => ServiceRequest, serviceRequest => serviceRequest.messages, {
      onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'service_request_id', referencedColumnName: 'request_id' })
  serviceRequest: ServiceRequest;

}
