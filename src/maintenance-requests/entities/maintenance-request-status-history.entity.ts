import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { MaintenanceRequest } from './maintenance-request.entity';
import { Users } from '../../users/entities/user.entity';
import { MaintenanceRequestStatusEnum } from '../dto/create-maintenance-request.dto';

@Entity({ name: 'maintenance_request_status_history' })
export class MaintenanceRequestStatusHistory extends BaseEntity {
  @Column({ nullable: false, type: 'uuid' })
  maintenance_request_id: string;

  @Column({
    nullable: true,
    type: 'enum',
    enum: [
      MaintenanceRequestStatusEnum.NOT_APPROVED,
      MaintenanceRequestStatusEnum.APPROVED,
      MaintenanceRequestStatusEnum.RESOLVED,
      MaintenanceRequestStatusEnum.REOPENED,
      MaintenanceRequestStatusEnum.CLOSED,
    ],
  })
  previous_status: MaintenanceRequestStatusEnum | null;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [
      MaintenanceRequestStatusEnum.NOT_APPROVED,
      MaintenanceRequestStatusEnum.APPROVED,
      MaintenanceRequestStatusEnum.RESOLVED,
      MaintenanceRequestStatusEnum.REOPENED,
      MaintenanceRequestStatusEnum.CLOSED,
    ],
  })
  new_status: MaintenanceRequestStatusEnum;

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

  @ManyToOne(() => MaintenanceRequest, (mr) => mr.statusHistory, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'maintenance_request_id', referencedColumnName: 'id' })
  maintenanceRequest: MaintenanceRequest;

  @ManyToOne(() => Users, (u) => u.id)
  @JoinColumn({ name: 'changed_by_user_id', referencedColumnName: 'id' })
  changedBy: Users;
}
