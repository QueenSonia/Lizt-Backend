import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Users } from '../../users/entities/user.entity';

@Entity({ name: 'property_groups' })
export class PropertyGroup extends BaseEntity {
  @Column({ nullable: false, type: 'varchar' })
  name: string;

  @Column({ nullable: false, type: 'uuid' })
  owner_id: string;

  @Column({ nullable: false, type: 'uuid', array: true })
  property_ids: string[];

  @ManyToOne(() => Users)
  @JoinColumn({ name: 'owner_id', referencedColumnName: 'id' })
  owner: Users;
}
