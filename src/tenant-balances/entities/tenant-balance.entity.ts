import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Account } from 'src/users/entities/account.entity';

@Entity({ name: 'tenant_balances' })
@Unique(['tenant_id', 'landlord_id'])
export class TenantBalance extends BaseEntity {
  @Column({ nullable: false, type: 'uuid' })
  tenant_id!: string;

  @Column({ nullable: false, type: 'uuid' })
  landlord_id!: string;

  /**
   * Unified signed wallet balance.
   * positive = tenant has credit (overpaid)
   * negative = tenant owes (outstanding)
   */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  balance!: number;

  /** Optional reason for an initial balance set at onboarding. */
  @Column({ nullable: true, type: 'text' })
  notes!: string | null;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant!: Account;

  @ManyToOne(() => Account, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'landlord_id', referencedColumnName: 'id' })
  landlord!: Account;
}
