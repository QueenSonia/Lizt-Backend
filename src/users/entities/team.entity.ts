import { BaseEntity } from 'src/base.entity';
import { Column, Entity, JoinColumn, OneToMany, OneToOne } from 'typeorm';
import { TeamMember } from './team-member.entity';
import { Account } from './account.entity';

@Entity()
export class Team extends BaseEntity {
  @Column({ nullable: false, type: 'varchar' })
  name: string;

  @Column({ nullable:false, type: 'uuid' })
  creatorId: string;

  @OneToOne(() => Account, (account) => account.team, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'creatorId' })
  creator: Account;

  @OneToMany(() => TeamMember, (teamMember) => teamMember.team)
  members: TeamMember[];
}
