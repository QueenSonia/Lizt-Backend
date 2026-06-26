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
  MaintenanceRequestKindEnum,
  MaintenanceRequestScopeEnum,
  MaintenanceRequestStatusEnum,
  MediaItem,
} from '../dto/create-maintenance-request.dto';
import { JobCategoryEnum } from '../dto/job-category.enum';
import { Account } from 'src/users/entities/account.entity';
import { ChatMessage } from 'src/chat/chat-message.entity';
import { Notification } from 'src/notifications/entities/notification.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { MaintenanceRequestStatusHistory } from './maintenance-request-status-history.entity';
import { CommonArea } from 'src/common-areas/entities/common-area.entity';
import { Artisan } from 'src/artisans/entities/artisan.entity';

@Entity({ name: 'maintenance_requests' })
export class MaintenanceRequest extends BaseEntity {
  @Column({ nullable: false, type: 'varchar', unique: true })
  request_id: string;

  @Column({ nullable: true, type: 'varchar' })
  tenant_name: string | null;

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

  // Unified attachment list (photos + videos). Replaces the old
  // `issue_images string[]`; each item carries its media type and the
  // `attempt` cycle it was added in. See MediaItem.
  @Column({ nullable: true, type: 'jsonb' })
  issue_media?: MediaItem[] | null;

  // Report cycle counter: 1 at creation, incremented on each REOPENED
  // transition. Used to tag media so attachments group per cycle.
  @Column({ nullable: false, type: 'int', default: 1 })
  current_attempt: number;

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

  @Column({ nullable: true, type: 'uuid' })
  artisan_id?: string | null;

  @ManyToOne(() => Artisan, (artisan) => artisan.maintenance_requests, {
    onDelete: 'SET NULL',
  })
  @JoinColumn({ name: 'artisan_id', referencedColumnName: 'id' })
  artisan?: Artisan | null;

  // Snapshots captured at resolve time. They survive renames/deletes of the
  // artisan row, so historical resolutions show what the FM actually entered.
  @Column({ nullable: true, type: 'varchar' })
  artisan_name_snapshot?: string | null;

  @Column({ nullable: true, type: 'varchar' })
  artisan_phone_snapshot?: string | null;

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
      MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
      MaintenanceRequestStatusEnum.DENIED_BY_TENANT,
      MaintenanceRequestStatusEnum.NOTICE_OPEN,
    ],
    default: MaintenanceRequestStatusEnum.NOT_APPROVED,
  })
  status: MaintenanceRequestStatusEnum;

  @Column({ nullable: false, type: 'boolean', default: false })
  is_urgent: boolean;

  @Column({ nullable: false, type: 'boolean', default: false })
  is_priority: boolean;

  @Column({ nullable: true, type: 'timestamp with time zone' })
  approved_at: Date | null;

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
      MaintenanceRequestCreatorTypeEnum.LANDLORD,
    ],
    default: MaintenanceRequestCreatorTypeEnum.TENANT,
  })
  creator_type: MaintenanceRequestCreatorTypeEnum;

  // repair = something to fix (FM pipeline); notice = informational message for
  // the landlord (no FM, landlord-ack lifecycle). Defaults to repair so every
  // existing request and all non-notice paths are repairs.
  @Column({
    nullable: false,
    type: 'enum',
    enum: [
      MaintenanceRequestKindEnum.REPAIR,
      MaintenanceRequestKindEnum.NOTICE,
    ],
    default: MaintenanceRequestKindEnum.REPAIR,
  })
  kind: MaintenanceRequestKindEnum;

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
