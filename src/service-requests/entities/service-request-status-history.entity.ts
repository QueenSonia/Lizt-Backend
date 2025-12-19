import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { ServiceRequest } from './service-request.entity';
import { Users } from '../../users/entities/user.entity';
import { ServiceRequestStatusEnum } from '../dto/create-service-request.dto';

@Entity({ name: 'service_request_status_history' })
export class ServiceRequestStatusHistory extends BaseEntity {
  @Column({ nullable: false, type: 'uuid' })
  service_request_id: string;

  @Column({
    nullable: true,
    type: 'enum',
    enum: [
      ServiceRequestStatusEnum.PENDING,
      ServiceRequestStatusEnum.OPEN,
      ServiceRequestStatusEnum.IN_PROGRESS,
      ServiceRequestStatusEnum.RESOLVED,
      ServiceRequestStatusEnum.CLOSED,
      ServiceRequestStatusEnum.REOPENED,
      ServiceRequestStatusEnum.URGENT,
    ],
  })
  previous_status: string | null;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [
      ServiceRequestStatusEnum.PENDING,
      ServiceRequestStatusEnum.OPEN,
      ServiceRequestStatusEnum.IN_PROGRESS,
      ServiceRequestStatusEnum.RESOLVED,
      ServiceRequestStatusEnum.CLOSED,
      ServiceRequestStatusEnum.REOPENED,
      ServiceRequestStatusEnum.URGENT,
    ],
  })
  new_status: string;

  @Column({ nullable: false, type: 'uuid' })
  changed_by_user_id: string;

  @Column({ nullable: false, type: 'varchar' })
  changed_by_role: string; // 'tenant', 'facility_manager', 'landlord', 'system'

  @Column({ nullable: true, type: 'text' })
  change_reason?: string | null;

  @Column({ nullable: true, type: 'text' })
  notes?: string | null;

  @Column({ nullable: false, type: 'timestamp' })
  changed_at: Date;

  @ManyToOne(() => ServiceRequest, (sr) => sr.statusHistory, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'service_request_id', referencedColumnName: 'id' })
  serviceRequest: ServiceRequest;

  @ManyToOne(() => Users, (u) => u.id)
  @JoinColumn({ name: 'changed_by_user_id', referencedColumnName: 'id' })
  changedBy: Users;
}
