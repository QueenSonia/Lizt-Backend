import { BaseEntity } from "src/base.entity";
import { Column, Entity, OneToMany } from "typeorm";
import { TeamMember } from "./team-member.entity";


@Entity()
export class Team extends BaseEntity {

  @Column({ nullable: false, type: "varchar" })
  name: string;

  @Column({ nullable: false, type: 'varchar' })
  creator_id: string;

  @OneToMany(() => TeamMember, (teamMember) => teamMember.team)
  members: TeamMember[];
}
