import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Property } from '../../properties/entities/property.entity';
import { Users } from '../../users/entities/user.entity';
import { RentStatusEnum } from '../dto/create-rent.dto';

@Entity({ name: 'rents' })
export class Rent extends BaseEntity {
  @Column({ nullable: false, type: 'uuid' })
  property_id: string;

  @Column({ nullable: false, type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'int', nullable: false })
  amount_paid: number;

  @Column({ nullable: false, type: 'timestamp' })
  expiry_date: Date;

  @Column({ nullable: true, type: 'varchar', array: true })
  rent_receipts: string[];

  @Column({
    nullable: false,
    type: 'enum',
    enum: [RentStatusEnum.PENDING, RentStatusEnum.PAID, RentStatusEnum.OWING],
    default: RentStatusEnum.PENDING,
  })
  status: string;

  @ManyToOne(() => Property, (p) => p.rents)
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property;

  @ManyToOne(() => Users, (u) => u.rents)
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant: Users;
}
