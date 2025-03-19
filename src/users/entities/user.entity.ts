import { Column, Entity, OneToMany, Unique } from 'typeorm';
import { BaseEntity, RolesEnum } from '../../base.entity';
import { Property } from 'src/properties/entities/property.entity';

@Unique(['email'])
@Unique(['phone_number'])
@Entity({ name: 'users' })
export class Users extends BaseEntity {
  @Column({ nullable: false, type: 'varchar' })
  first_name: string;

  @Column({ nullable: false, type: 'varchar' })
  last_name: string;

  @Column({ nullable: false, type: 'varchar' })
  email: string;

  @Column({ nullable: false, type: 'varchar' })
  phone_number: string;

  @Column({ nullable: true, type: 'varchar' })
  password: string;

  @Column({
    nullable: false,
    type: 'varchar',
    enum: [RolesEnum.ADMIN, RolesEnum.TENANT],
    default: RolesEnum.TENANT,
  })
  role: string;

  @OneToMany(() => Property, (p) => p.Tenant)
  properties: Property[];
}
