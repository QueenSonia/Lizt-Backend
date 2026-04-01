import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Account } from 'src/users/entities/account.entity';
import { Property } from 'src/properties/entities/property.entity';

export enum TenantBalanceLedgerType {
  INITIAL_BALANCE = 'initial_balance',
  AUTO_RENEWAL = 'auto_renewal',
  RENT_PAYMENT = 'rent_payment',
  OB_PAYMENT = 'ob_payment',
  CREDIT_APPLIED = 'credit_applied',
  CREDIT_ADDED = 'credit_added',
  MIGRATION = 'migration',
}

@Entity({ name: 'tenant_balance_ledger' })
export class TenantBalanceLedger extends BaseEntity {
  @Column({ nullable: false, type: 'uuid' })
  tenant_id: string;

  @Column({ nullable: false, type: 'uuid' })
  landlord_id: string;

  @Column({ nullable: true, type: 'uuid' })
  property_id: string | null;

  @Column({
    nullable: false,
    type: 'enum',
    enum: TenantBalanceLedgerType,
  })
  type: TenantBalanceLedgerType;

  /** Human-readable description shown in the breakdown modal. */
  @Column({ nullable: false, type: 'text' })
  description: string;

  /** Positive = balance increased; negative = balance decreased. */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  outstanding_balance_change: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  credit_balance_change: number;

  /** Snapshot of outstanding_balance after this change. */
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  outstanding_balance_after: number;

  /** Snapshot of credit_balance after this change. */
  @Column({ type: 'decimal', precision: 12, scale: 2 })
  credit_balance_after: number;

  /** The entity (rent / renewal_invoice) that triggered this change. */
  @Column({ nullable: true, type: 'varchar', length: 50 })
  related_entity_type: string | null;

  @Column({ nullable: true, type: 'uuid' })
  related_entity_id: string | null;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant: Account;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'landlord_id', referencedColumnName: 'id' })
  landlord: Account;

  @ManyToOne(() => Property, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property | null;
}
