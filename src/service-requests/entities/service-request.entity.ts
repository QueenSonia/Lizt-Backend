import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Users } from '../../users/entities/user.entity';
import { Property } from '../../properties/entities/property.entity';
import { ServiceRequestStatusEnum } from '../dto/create-service-request.dto';
import { Account } from 'src/users/entities/account.entity';
import { ChatMessage } from 'src/chat/chat-message.entity';


@Entity({ name: 'service_requests' })
export class ServiceRequest extends BaseEntity {
  @Column({ nullable: false, type: 'varchar', unique: true })
  request_id: string;

  @Column({ nullable: false, type: 'varchar' })
  tenant_name: string;

  @Column({ nullable: false, type: 'varchar' })
  property_name: string;

  @Column({ nullable: false, type: 'varchar' })
  issue_category: string;

  @Column({ nullable: false, type: 'timestamp' })
  date_reported: Date;

  @Column({ nullable: true, type: 'timestamp' })
  resolution_date?: Date | null;

  @Column({ nullable: false, type: 'text' })
  description: string;

  @Column({ nullable: true, type: 'varchar', array: true })
  issue_images?: string[] | null;

  @Column({ nullable: true })
  resolvedAt: Date;

    @Column('text', { nullable: true })
  notes: string;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [
      ServiceRequestStatusEnum.PENDING,
      ServiceRequestStatusEnum.IN_PROGRESS,
      ServiceRequestStatusEnum.RESOLVED,
      ServiceRequestStatusEnum.URGENT,
    ],
    default: ServiceRequestStatusEnum.PENDING,
  })
  status: string | null;

  @Column({ nullable: false, type: 'uuid' })
  tenant_id: string;

  @Column({ nullable: false, type: 'uuid' })
  property_id: string;

  @ManyToOne(() => Account, (u) => u.service_requests)
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant: Account;

  @ManyToOne(() => Property, (p) => p.service_requests)
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property;

    @OneToMany(() => ChatMessage, message => message.serviceRequest)
  messages: ChatMessage[];
}
