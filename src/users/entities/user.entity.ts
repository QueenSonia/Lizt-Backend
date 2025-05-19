import { Column, Entity, OneToMany, OneToOne, Unique } from 'typeorm';
import { BaseEntity, RolesEnum } from '../../base.entity';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { NoticeAgreement } from 'src/notice-agreements/entities/notice-agreement.entity';
import { KYC } from './kyc.entity';
import { Account } from './account.entity';

@Unique(['email'])
// @Unique(['phone_number'])
@Entity({ name: 'users' })
export class Users extends BaseEntity {
  @Column({ nullable: false, type: 'varchar' })
  first_name: string;

  @Column({ nullable: false, type: 'varchar' })
  last_name: string;

  @Column({ nullable: false, type: 'varchar' })
  email: string;

  @Column({ nullable: false, type: 'varchar' })
  phone_number: string;

  @Column({ nullable: true, type: 'varchar' })
  password: string;

  @Column({
    nullable: false,
    type: 'varchar',
    enum: [RolesEnum.ADMIN, RolesEnum.TENANT],
    default: RolesEnum.TENANT,
  })
  role: string;

  @Column({ nullable: false, type: 'boolean', default: false })
  is_verified: boolean;

  @Column({ nullable: true, type: 'varchar', array: true })
  logo_urls?: string[] | null;

  @Column({ nullable: true, type: 'uuid' })
  creator_id?: string | null;

  @OneToMany(() => Account, (account) => account.user)
  accounts: Account[];

  @OneToMany(() => Property, (p) => p.owner)
  properties: Property[];

  @OneToMany(() => Rent, (r) => r.tenant)
  rents: Rent[];

  @OneToMany(() => ServiceRequest, (sr) => sr.tenant)
  service_requests: ServiceRequest[];

  @OneToMany(() => PropertyTenant, (pt) => pt.tenant)
  property_tenants: PropertyTenant[];

  @OneToMany(() => PropertyHistory, (ph) => ph.tenant)
  property_histories: PropertyHistory[];

  @OneToMany(() => NoticeAgreement, (na) => na.tenant)
  notice_agreements: NoticeAgreement[];

  @OneToOne(() => KYC, (kyc) => kyc.user)
  kyc: KYC;
}
