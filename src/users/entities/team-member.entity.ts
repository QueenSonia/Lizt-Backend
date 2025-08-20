import { BaseEntity, RolesEnum } from 'src/base.entity';
import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Account } from './account.entity';
import { Team } from './team.entity';

@Entity()
export class TeamMember extends BaseEntity {

  @Column({ nullable: false, type: 'varchar' })
  email: string;

  @Column({ nullable: false, type: 'uuid' })
  team_id: string;

  @ManyToOne(() => Team, (team) => team.members, { onDelete: 'CASCADE' })
  team: Team;

  @Column({ nullable: true, type: 'uuid' })
  account_id: string;

  @ManyToOne(() => Account, (account) => account.teamMemberships, {
    onDelete: 'CASCADE',
  })
  account: Account;


    @Column({
      nullable: false,
      type: 'enum',
      enum: RolesEnum,
      default: RolesEnum.FACILITY_MANAGER,
    })
    role: string;
  
  // store permissions specific to this member in the team
  @Column({ type: 'varchar', array: true, nullable: true })
  permissions: string[];
}
