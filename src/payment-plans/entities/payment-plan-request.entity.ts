import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { PropertyTenant } from '../../properties/entities/property-tenants.entity';
import { Property } from '../../properties/entities/property.entity';
import { Account } from '../../users/entities/account.entity';
import { RenewalInvoice } from '../../tenancies/entities/renewal-invoice.entity';
import { PaymentPlan } from './payment-plan.entity';
import { Fee } from '../../common/billing/fees';

export enum PaymentPlanRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  DECLINED = 'declined',
}

export enum PaymentPlanRequestSource {
  RENT = 'rent',
  OB = 'ob',
}

@Entity({ name: 'payment_plan_requests' })
@Index(['property_tenant_id'])
@Index(['property_id'])
@Index(['tenant_id'])
@Index(['renewal_invoice_id'])
@Index(['status'])
export class PaymentPlanRequest extends BaseEntity {
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

  @Column({ type: 'uuid', nullable: true })
  renewal_invoice_id: string | null;

  @ManyToOne(() => RenewalInvoice, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'renewal_invoice_id' })
  renewalInvoice: RenewalInvoice | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total_amount: number;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  fee_breakdown: Fee[];

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  installment_amount: number | null;

  @Column({ type: 'text' })
  preferred_schedule: string;

  @Column({ type: 'text', nullable: true })
  tenant_note: string | null;

  @Column({ type: 'varchar', length: 10, default: PaymentPlanRequestSource.RENT })
  source: PaymentPlanRequestSource;

  @Column({
    type: 'varchar',
    length: 20,
    default: PaymentPlanRequestStatus.PENDING,
  })
  status: PaymentPlanRequestStatus;

  @Column({ type: 'uuid', nullable: true })
  created_payment_plan_id: string | null;

  @ManyToOne(() => PaymentPlan, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_payment_plan_id' })
  createdPaymentPlan: PaymentPlan | null;

  @Column({ type: 'timestamp', nullable: true })
  decided_at: Date | null;

  @Column({ type: 'uuid', nullable: true })
  decided_by_user_id: string | null;

  @Column({ type: 'text', nullable: true })
  decline_reason: string | null;
}
