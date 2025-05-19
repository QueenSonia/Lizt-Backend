import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Users } from 'src/users/entities/user.entity';
import { Property } from './property.entity';
import { TenantStatusEnum } from '../dto/create-property.dto';
import { Account } from 'src/users/entities/account.entity';

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

  @ManyToOne(() => Property, (p) => p.property_tenants)
  @JoinColumn({ name: 'property_id', referencedColumnName: 'id' })
  property: Property;

  @ManyToOne(() => Account, (u) => u.property_tenants)
  @JoinColumn({ name: 'tenant_id', referencedColumnName: 'id' })
  tenant: Account;
}
