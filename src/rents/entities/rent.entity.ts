import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Property } from '../../properties/entities/property.entity';
import { Users } from '../../users/entities/user.entity';
import { RentPaymentStatusEnum, RentStatusEnum } from '../dto/create-rent.dto';
import { Account } from 'src/users/entities/account.entity';

@Entity({ name: 'rents' })
export class Rent extends BaseEntity {
  @Column({ nullable: false, type: 'uuid' })
  property_id: string;

  @Column({ nullable: false, type: 'uuid' })
  tenant_id: string;

  @Column({ type: 'int', nullable: false })
  amount_paid: number;

  @Column({ nullable: true, type: 'timestamp' })
  expiry_date: Date;

  @Column({ nullable: false, type: 'timestamp' })
  lease_start_date: Date;

  @Column({ nullable: false, type: 'timestamp' })
  lease_end_date: Date;

  @Column({ nullable: true, type: 'varchar', array: true })
  rent_receipts?: string[] | null;

  @Column({ type: 'int', nullable: true })
    rental_price: number;
  
    @Column({ type: 'int', nullable: true })
    security_deposit: number;
  
    @Column({ type: 'int', nullable: true })
    service_charge: number;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [RentPaymentStatusEnum.PENDING, RentPaymentStatusEnum.PAID, RentPaymentStatusEnum.OWING],
    default: RentPaymentStatusEnum.PENDING,
  })
  payment_status: string;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [RentStatusEnum.INACTIVE, RentStatusEnum.ACTIVE],
    default: RentStatusEnum.INACTIVE,
  })
  rent_status: string;

  @ManyToOne(() => Property, (p) => p.rents)
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property;

  @ManyToOne(() =>Account, (u) => u.rents)
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant: Account;
}
