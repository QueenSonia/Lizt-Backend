import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  Unique,
} from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Team } from '../../users/entities/team.entity';
import { Account } from '../../users/entities/account.entity';
import { MaintenanceRequest } from '../../maintenance-requests/entities/maintenance-request.entity';

// Tradesperson (plumber, electrician, …) an FM hires when resolving a
// maintenance request. Not a login account — a contact record scoped to the
// landlord's team. Dedup key is (team_id, phone). Skills are derived from the
// distinct `resolution_category` values across the maintenance_requests this
// artisan is linked to — no skills column.
@Entity({ name: 'artisans' })
@Unique('uq_artisans_team_phone', ['team_id', 'phone'])
export class Artisan extends BaseEntity {
  @Index('idx_artisans_team_id')
  @Column({ nullable: false, type: 'uuid' })
  team_id: string;

  @ManyToOne(() => Team, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'team_id', referencedColumnName: 'id' })
  team: Team;

  @Column({ nullable: false, type: 'varchar' })
  name: string;

  // Canonical `234XXXXXXXXXX` — same convention as users.phone_number.
  // Normalize via UtilService.normalizePhoneNumber before write.
  @Column({ nullable: false, type: 'varchar' })
  phone: string;

  @Column({ nullable: false, type: 'uuid' })
  created_by_account_id: string;

  @ManyToOne(() => Account, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'created_by_account_id', referencedColumnName: 'id' })
  createdByAccount: Account;

  @OneToMany(() => MaintenanceRequest, (mr) => mr.artisan)
  maintenance_requests: MaintenanceRequest[];
}
