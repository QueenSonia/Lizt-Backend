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
  MaintenanceRequestCreatorTypeEnum,
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
} from '../dto/create-maintenance-request.dto';
import { JobCategoryEnum } from '../dto/job-category.enum';
import { Account } from 'src/users/entities/account.entity';
import { ChatMessage } from 'src/chat/chat-message.entity';
import { Notification } from 'src/notifications/entities/notification.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { MaintenanceRequestStatusHistory } from './maintenance-request-status-history.entity';
import { CommonArea } from 'src/common-areas/entities/common-area.entity';

@Entity({ name: 'maintenance_requests' })
export class MaintenanceRequest extends BaseEntity {
  @Column({ nullable: false, type: 'varchar', unique: true })
  request_id: string;

  @Column({ nullable: false, type: 'varchar' })
  tenant_name: string;

  @Column({ nullable: true, type: 'varchar' })
  property_name: string | null;

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

  @Column('text', { nullable: true })
  rejection_reason: string | null;

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
      MaintenanceRequestStatusEnum.NOT_APPROVED,
      MaintenanceRequestStatusEnum.APPROVED,
      MaintenanceRequestStatusEnum.RESOLVED,
      MaintenanceRequestStatusEnum.REOPENED,
      MaintenanceRequestStatusEnum.CLOSED,
      MaintenanceRequestStatusEnum.REJECTED,
    ],
    default: MaintenanceRequestStatusEnum.NOT_APPROVED,
  })
  status: MaintenanceRequestStatusEnum;

  @Column({ nullable: false, type: 'boolean', default: false })
  is_urgent: boolean;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [
      MaintenanceRequestScopeEnum.UNIT,
      MaintenanceRequestScopeEnum.COMMON_AREA,
    ],
    default: MaintenanceRequestScopeEnum.UNIT,
  })
  scope: MaintenanceRequestScopeEnum;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [
      MaintenanceRequestCreatorTypeEnum.TENANT,
      MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
    ],
    default: MaintenanceRequestCreatorTypeEnum.TENANT,
  })
  creator_type: MaintenanceRequestCreatorTypeEnum;

  @Column({ nullable: true, type: 'uuid' })
  creator_user_id: string | null;

  @ManyToOne(() => Users, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'creator_user_id', referencedColumnName: 'id' })
  creator: Users | null;

  @Column({ nullable: true, type: 'uuid' })
  tenant_id: string | null;

  @Column({ nullable: true, type: 'uuid' })
  property_id: string | null;

  @Column({ nullable: true, type: 'uuid' })
  common_area_id: string | null;

  @ManyToOne(() => Account, (u) => u.maintenance_requests)
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant: Account | null;

  @ManyToOne(() => Property, (p) => p.maintenance_requests, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property | null;

  @ManyToOne(() => CommonArea, (ca) => ca.maintenance_requests, {
    onDelete: 'SET NULL',
    nullable: true,
  })
  @JoinColumn({ name: 'common_area_id', referencedColumnName: 'id' })
  common_area: CommonArea | null;

  @OneToMany(() => ChatMessage, (message) => message.maintenanceRequest)
  messages: ChatMessage[];

  @OneToMany(() => Notification, (notification) => notification.maintenanceRequest)
  notifications: Notification[];

  @Column({ nullable: true, type: 'uuid' })
  assigned_to: string | null;

  @ManyToOne(() => TeamMember, (tm) => tm.account, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'assigned_to', referencedColumnName: 'id' })
  facilityManager: TeamMember | null;

  @OneToMany(
    () => MaintenanceRequestStatusHistory,
    (history) => history.maintenanceRequest,
  )
  statusHistory: MaintenanceRequestStatusHistory[];
}
