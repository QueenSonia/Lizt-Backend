import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { PropertyStatusEnum } from '../dto/create-property.dto';
import { Users } from 'src/users/entities/user.entity';
import { Rent } from 'src/rents/entities/rent.entity';

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

  @Column({ nullable: false, type: 'uuid' })
  owner_id: string;

  @Column({ nullable: true, type: 'varchar' })
  property_type: string;

  @Column({ nullable: true, type: 'varchar', array: true })
  property_images: string[];

  @Column({ nullable: false, type: 'int' })
  no_of_bedrooms: number;

  @Column({ type: 'numeric', precision: 11, scale: 2, nullable: false })
  rental_price: number;

  @Column({ nullable: false, type: 'varchar' })
  payment_frequency: string;

  @Column({ nullable: false, type: 'int' })
  lease_duration: number;

  @Column({ type: 'numeric', precision: 11, scale: 2, nullable: false })
  security_deposit: number;

  @Column({ type: 'numeric', precision: 11, scale: 2, nullable: false })
  service_charge: number;

  @Column({ nullable: true, type: 'text' })
  comment: string;

  @Column({ nullable: true, type: 'date' })
  move_in_date: Date;

  @ManyToOne(() => Users, (t) => t.properties)
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant: Users;

  @ManyToOne(() => Users, (o) => o.owner_properties)
  @JoinColumn({ name: 'owner_id', referencedColumnName: 'id' })
  owner: Users;

  @OneToMany(() => Rent, (r) => r.property)
  rents: Rent[];
}
