import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { PropertyTenant } from '../../properties/entities/property-tenants.entity';
import { Property } from '../../properties/entities/property.entity';
import { Account } from '../../users/entities/account.entity';
import { AdHocInvoiceLineItem } from './ad-hoc-invoice-line-item.entity';

export enum AdHocInvoiceStatus {
  PENDING = 'pending',
  PARTIAL = 'partial',
  PAID = 'paid',
  OVERDUE = 'overdue',
  CANCELLED = 'cancelled',
}

@Entity({ name: 'ad_hoc_invoices' })
@Index(['property_tenant_id'])
@Index(['property_id'])
@Index(['tenant_id'])
@Index(['landlord_id'])
@Index(['status'])
@Index(['public_token'], { unique: true })
@Index(['invoice_number'], { unique: true })
@Index(['receipt_token'], { unique: true, where: 'receipt_token IS NOT NULL' })
export class AdHocInvoice extends BaseEntity {
  @Column({ type: 'varchar', length: 50 })
  invoice_number: string;

  @Column({ type: 'uuid' })
  landlord_id: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'landlord_id' })
  landlord: Account;

  @Column({ type: 'uuid' })
  property_id: string;

  @ManyToOne(() => Property, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @Column({ type: 'uuid' })
  property_tenant_id: string;

  @ManyToOne(() => PropertyTenant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'property_tenant_id' })
  propertyTenant: PropertyTenant;

  @Column({ type: 'uuid' })
  tenant_id: string;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id' })
  tenant: Account;

  /** Tenant-facing pay-page token — set at creation. */
  @Column({ type: 'varchar', length: 64 })
  public_token: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total_amount: number;

  @Column({ type: 'varchar', length: 20, default: AdHocInvoiceStatus.PENDING })
  status: AdHocInvoiceStatus;

  /** How much of total_amount has been collected (drives PARTIAL status). */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  amount_paid: number;

  /**
   * Set when a payment plan owns this invoice's debt — its public pay link is
   * then locked. Plain uuid FK (DB foreign key lives in the migration, ON
   * DELETE SET NULL) to avoid an ad_hoc_invoices ↔ payment_plans import cycle.
   */
  @Column({ type: 'uuid', nullable: true })
  covered_by_plan_id: string | null;

  @Column({ type: 'date' })
  due_date: Date;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'timestamp', nullable: true })
  paid_at: Date | null;

  /** Paystack reference if paid via Paystack. */
  @Column({ type: 'varchar', length: 100, nullable: true })
  payment_reference: string | null;

  /** Paystack channel from verify response (card, bank_transfer, ussd, etc.). */
  @Column({ type: 'varchar', length: 50, nullable: true })
  payment_method: string | null;

  /** Set on successful payment — used for the public receipt page. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  receipt_token: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  receipt_number: string | null;

  @Column({ type: 'uuid', nullable: true })
  created_by_user_id: string | null;

  @OneToMany(() => AdHocInvoiceLineItem, (item) => item.invoice, {
    cascade: true,
  })
  line_items: AdHocInvoiceLineItem[];
}
