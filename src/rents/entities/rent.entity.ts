import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Property } from '../../properties/entities/property.entity';
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
  rent_start_date: Date;

  @Column({ nullable: true, type: 'varchar', array: true })
  rent_receipts?: string[] | null;

  @Column({ type: 'int', nullable: true })
  rental_price: number;

  @Column({ type: 'int', nullable: true })
  security_deposit: number;

  @Column({ type: 'int', nullable: true })
  service_charge: number;

  @Column({ type: 'boolean', default: true })
  service_charge_recurring: boolean;

  @Column({ type: 'boolean', default: false })
  security_deposit_recurring: boolean;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  legal_fee: number | null;

  @Column({ type: 'boolean', default: false })
  legal_fee_recurring: boolean;

  @Column({ type: 'numeric', precision: 12, scale: 2, nullable: true })
  agency_fee: number | null;

  @Column({ type: 'boolean', default: false })
  agency_fee_recurring: boolean;

  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  other_fees: Array<{
    externalId: string;
    name: string;
    amount: number;
    recurring: boolean;
  }>;

  @Column({ nullable: true, type: 'varchar' })
  payment_frequency: string;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [
      RentPaymentStatusEnum.PENDING,
      RentPaymentStatusEnum.PAID,
      RentPaymentStatusEnum.OWING,
    ],
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

  @ManyToOne(() => Property, (p) => p.rents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property;

  @ManyToOne(() => Account, (u) => u.rents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant: Account;
}
