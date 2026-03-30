import { BeforeInsert, Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
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

  /**
   * The original agreed-upon expiry date, set once at creation and never
   * touched by the roll-forward cron. Used to detect overdue rents even
   * after expiry_date has been advanced by the roll-forward logic.
   */
  @Column({ nullable: true, type: 'timestamp' })
  original_expiry_date: Date;

  @Column({ nullable: false, type: 'timestamp' })
  rent_start_date: Date;

  @BeforeInsert()
  setOriginalExpiryDate() {
    if (!this.original_expiry_date && this.expiry_date) {
      this.original_expiry_date = this.expiry_date;
    }
  }

  @Column({ nullable: true, type: 'varchar', array: true })
  rent_receipts?: string[] | null;

  @Column({ type: 'int', nullable: true })
  rental_price: number;

  @Column({ type: 'int', nullable: true })
  security_deposit: number;

  @Column({ type: 'int', nullable: true })
  service_charge: number;

  @Column({ type: 'int', nullable: true, default: 0 })
  outstanding_balance: number;

  @Column({ nullable: true, type: 'text' })
  outstanding_balance_reason?: string | null;

  @Column({ type: 'int', nullable: true, default: 0 })
  credit_balance: number;

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
