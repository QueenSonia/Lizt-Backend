import { Column, Entity, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Property } from './property.entity';
import { TenantStatusEnum } from '../dto/create-property.dto';
import { Account } from 'src/users/entities/account.entity';
import { Rent } from 'src/rents/entities/rent.entity';

@Entity({ name: 'property_tenants' })
export class PropertyTenant extends BaseEntity {
  @Column({ nullable: false, type: 'uuid' })
  property_id: string;

  @Column({ nullable: false, type: 'uuid' })
  tenant_id: string;

  @Column({
    nullable: false,
    type: 'enum',
    enum: [TenantStatusEnum.ACTIVE, TenantStatusEnum.INACTIVE],
    default: TenantStatusEnum.ACTIVE,
  })
  status: TenantStatusEnum;

  /**
   * When the tenant confirmed these tenancy details over WhatsApp (the
   * "Yes, correct" tap). NULL = not yet confirmed — the bot gates such tenants
   * until they confirm. Cleared back to NULL when a landlord edits the details,
   * forcing a re-confirm. See `gateUnconfirmedTenant` in TenantFlowService.
   */
  @Column({ type: 'timestamptz', nullable: true })
  details_confirmed_at: Date | null;

  @ManyToOne(() => Property, (p) => p.property_tenants, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property;

  @ManyToOne(() => Account, (u) => u.property_tenants, {
    onDelete: 'CASCADE',
    cascade: true,
  })
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant: Account;
}
