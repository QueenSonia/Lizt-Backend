import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Users } from '../../users/entities/user.entity';
import { Property } from '../../properties/entities/property.entity';
import {
  ServiceRequestCreatorTypeEnum,
  ServiceRequestScopeEnum,
  ServiceRequestStatusEnum,
} from '../dto/create-service-request.dto';
import { JobCategoryEnum } from '../dto/job-category.enum';
import { Account } from 'src/users/entities/account.entity';
import { ChatMessage } from 'src/chat/chat-message.entity';
import { Notification } from 'src/notifications/entities/notification.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { ServiceRequestStatusHistory } from './service-request-status-history.entity';

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

  @Column({ nullable: true, type: 'timestamp' })
  reopened_at?: Date | null;

  @Column('text', { nullable: true })
  notes: string;

  @Column({ nullable: true, type: 'integer' })
  resolution_cost_minor?: number | null;

  @Column({ nullable: true, type: 'varchar', length: 64 })
  resolution_category?: JobCategoryEnum | null;

  @Column({ nullable: true, type: 'text' })
  resolution_summary?: string | null;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [
      ServiceRequestStatusEnum.NOT_APPROVED,
      ServiceRequestStatusEnum.APPROVED,
      ServiceRequestStatusEnum.RESOLVED,
      ServiceRequestStatusEnum.REOPENED,
      ServiceRequestStatusEnum.CLOSED,
    ],
    default: ServiceRequestStatusEnum.NOT_APPROVED,
  })
  status: ServiceRequestStatusEnum;

  @Column({ nullable: false, type: 'boolean', default: false })
  is_urgent: boolean;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [
      ServiceRequestScopeEnum.UNIT,
      ServiceRequestScopeEnum.COMMON_AREA,
    ],
    default: ServiceRequestScopeEnum.UNIT,
  })
  scope: ServiceRequestScopeEnum;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [
      ServiceRequestCreatorTypeEnum.TENANT,
      ServiceRequestCreatorTypeEnum.FACILITY_MANAGER,
    ],
    default: ServiceRequestCreatorTypeEnum.TENANT,
  })
  creator_type: ServiceRequestCreatorTypeEnum;

  @Column({ nullable: true, type: 'uuid' })
  creator_user_id: string | null;

  @ManyToOne(() => Users, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'creator_user_id', referencedColumnName: 'id' })
  creator: Users | null;

  @Column({ nullable: true, type: 'uuid' })
  tenant_id: string | null;

  @Column({ nullable: false, type: 'uuid' })
  property_id: string;

  @ManyToOne(() => Account, (u) => u.service_requests)
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant: Account | null;

  @ManyToOne(() => Property, (p) => p.service_requests, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property;

  @OneToMany(() => ChatMessage, (message) => message.serviceRequest)
  messages: ChatMessage[];

  @OneToMany(() => Notification, (notification) => notification.serviceRequest)
  notifications: Notification[];

  @Column({ nullable: true, type: 'uuid' })
  assigned_to: string;

  @ManyToOne(() => TeamMember, (tm) => tm.account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'assigned_to', referencedColumnName: 'id' })
  facilityManager: TeamMember;

  @OneToMany(
    () => ServiceRequestStatusHistory,
    (history) => history.serviceRequest,
  )
  statusHistory: ServiceRequestStatusHistory[];
}
