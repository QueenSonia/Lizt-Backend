import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { PropertyStatusEnum } from '../dto/create-property.dto';
import { Users } from 'src/users/entities/user.entity';

@Entity({ name: 'properties' })
export class Property extends BaseEntity {
  @Column({ nullable: false, type: 'varchar' })
  name: string;

  @Column({ nullable: false, type: 'varchar' })
  location: string;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [PropertyStatusEnum.NOT_VACANT, PropertyStatusEnum.VACANT],
    default: PropertyStatusEnum.VACANT,
  })
  property_status: PropertyStatusEnum;

  @Column({ nullable: true, type: 'uuid' })
  tenant_id: string;

  @Column({ nullable: false, type: 'int' })
  no_of_bathrooms: number;

  @Column({ nullable: false, type: 'int' })
  no_of_bedrooms: number;

  @Column({ nullable: false, type: 'varchar' })
  rental_price: string;

  @Column({ nullable: false, type: 'varchar' })
  payment_frequency: string;

  @Column({ nullable: false, type: 'int' })
  lease_duration: number;

  @Column({ nullable: false, type: 'varchar' })
  security_deposit: string;

  @Column({ nullable: false, type: 'varchar' })
  service_charge: string;

  @Column({ nullable: true, type: 'varchar' })
  comment: string;

  @Column({ nullable: true, type: 'date' })
  move_in_date: Date;

  @Column({ nullable: true, type: 'varchar' })
  occupant_status: string;

  @Column({ nullable: true, type: 'varchar' })
  build_year: string;

  @ManyToOne(() => Users, (t) => t.properties)
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  Tenant: Users;
}
