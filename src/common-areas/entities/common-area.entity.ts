import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Account } from '../../users/entities/account.entity';
import { MaintenanceRequest } from '../../maintenance-requests/entities/maintenance-request.entity';

@Entity({ name: 'common_areas' })
export class CommonArea extends BaseEntity {
  // owner_id is the landlord's Account.id (matches property.owner_id). It used
  // to hold the landlord's User.id; migration 1801… repointed it to accounts.id
  // so every owner column in the app speaks the same id type.
  @Index('idx_common_areas_owner_id')
  @Column({ nullable: false, type: 'uuid' })
  owner_id: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'owner_id', referencedColumnName: 'id' })
  owner: Account;

  @Column({ nullable: false, type: 'varchar', length: 120 })
  name: string;

  @Column({ nullable: false, type: 'text' })
  address: string;

  @OneToMany(() => MaintenanceRequest, (sr) => sr.common_area)
  maintenance_requests: MaintenanceRequest[];
}
