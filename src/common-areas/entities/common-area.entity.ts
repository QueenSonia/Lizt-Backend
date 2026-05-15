import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Users } from '../../users/entities/user.entity';
import { MaintenanceRequest } from '../../maintenance-requests/entities/maintenance-request.entity';

@Entity({ name: 'common_areas' })
export class CommonArea extends BaseEntity {
  @Index('idx_common_areas_owner_id')
  @Column({ nullable: false, type: 'uuid' })
  owner_id: string;

  @ManyToOne(() => Users, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id', referencedColumnName: 'id' })
  owner: Users;

  @Column({ nullable: false, type: 'varchar', length: 120 })
  name: string;

  @Column({ nullable: false, type: 'text' })
  address: string;

  @OneToMany(() => MaintenanceRequest, (sr) => sr.common_area)
  maintenance_requests: MaintenanceRequest[];
}
