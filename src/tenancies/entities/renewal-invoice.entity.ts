import { Entity, Column, ManyToOne, JoinColumn, Index } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { PropertyTenant } from '../../properties/entities/property-tenants.entity';
import { Property } from '../../properties/entities/property.entity';
import { Account } from '../../users/entities/account.entity';

export enum RenewalPaymentStatus {
  UNPAID = 'unpaid',
  PAID = 'paid',
}

@Entity('renewal_invoices')
@Index(['token'])
@Index(['property_tenant_id'])
@Index(['payment_status'])
@Index(['created_at'])
export class RenewalInvoice extends BaseEntity {
  @Column({ type: 'varchar', length: 255, unique: true })
  token: string;

  @Column({ type: 'uuid' })
  property_tenant_id: string;

  @ManyToOne(() => PropertyTenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'property_tenant_id' })
  propertyTenant: PropertyTenant;

  @Column({ type: 'uuid' })
  property_id: string;

  @ManyToOne(() => Property, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Account;

  @Column({ type: 'date' })
  start_date: Date;

  @Column({ type: 'date' })
  end_date: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  rent_amount: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  service_charge: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  legal_fee: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0 })
  other_charges: number;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  total_amount: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: RenewalPaymentStatus.UNPAID,
  })
  payment_status: RenewalPaymentStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  payment_reference: string | null;

  @Column({ type: 'timestamp', nullable: true })
  paid_at: Date | null;

  @Column({ type: 'boolean', default: false })
  otp_verified: boolean;

  @Column({ type: 'timestamp', nullable: true })
  otp_verified_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  expires_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  receipt_token: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  receipt_number: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  payment_frequency: string | null;
}
