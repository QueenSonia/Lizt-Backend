// entities/notification.entity.ts
import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  ManyToOne,
  JoinColumn,
  OneToOne,
} from 'typeorm';
import { NotificationType } from '../enums/notification-type';
import { Account } from 'src/users/entities/account.entity';
import { Property } from 'src/properties/entities/property.entity';
import { BaseEntity } from 'src/base.entity';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';

@Entity()
export class Notification extends BaseEntity {
  @Column()
  date: string;

  @Column({ type: 'enum', enum: NotificationType })
  type: NotificationType;

  @Column()
  description: string;

  // Denormalized, normalized (lower + accent-stripped) bag of words assembled
  // at write time in NotificationService.create() from this row's fields plus
  // its related property/tenants/landlord/maintenance request. Powers the Live
  // Feed search (pg_trgm GIN index; see migration 1929). Snapshot semantics.
  @Column({ type: 'text', nullable: true })
  search_text: string | null;

  @Column({ default: 'Pending' })
  status: 'Pending' | 'Completed';

  // Nullable: common-area maintenance-request notifications carry a
  // common_area reference via maintenance_request_id instead of a direct
  // property link. Pre-existing FM-filed common-area MRs were silently
  // failing this INSERT when the column was NOT NULL.
  @Column({ type: 'uuid', nullable: true })
  property_id: string | null;

  @Column({ type: 'uuid', nullable: false })
  user_id: string;

  @Column({ type: 'uuid', nullable: true })
  maintenance_request_id: string;

  @ManyToOne(() => Property, (property) => property.notification, {
    onDelete: 'CASCADE',
    nullable: true,
  })
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property | null;

  @ManyToOne(() => Account, (user) => user.notification)
  @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
  user: Account; // <-- snake_case and UUID

  @ManyToOne(() => MaintenanceRequest, (request) => request.notifications, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'maintenance_request_id', referencedColumnName: 'id' })
  maintenanceRequest: MaintenanceRequest;
}
