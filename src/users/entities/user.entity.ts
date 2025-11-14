import {
  BeforeInsert,
  BeforeUpdate,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
  Unique,
} from 'typeorm';
import { BaseEntity, RolesEnum } from '../../base.entity';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { Rent } from 'src/rents/entities/rent.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { NoticeAgreement } from 'src/notice-agreements/entities/notice-agreement.entity';
import { KYC } from './kyc.entity';
import { Account } from './account.entity';
import { TenantKyc } from 'src/tenant-kyc/entities/tenant-kyc.entity';
import {
  Gender,
  MaritalStatus,
  EmploymentStatus,
} from 'src/tenant-kyc/entities/tenant-kyc.entity';
import { normalizePhoneNumber } from '../../utils/phone-number.transformer';

@Unique(['email'])
@Unique(['phone_number'])
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
    type: 'enum',
    enum: RolesEnum,
    default: RolesEnum.TENANT,
  })
  role: string;

  @Column({ nullable: false, type: 'boolean', default: false })
  is_verified: boolean;

  @Column({ nullable: true, type: 'varchar', array: true })
  logo_urls?: string[] | null;

  @Column({ nullable: true, type: 'uuid' })
  creator_id?: string | null;

  @Column({ nullable: true, type: 'date' })
  date_of_birth?: Date;

  @Column({ nullable: true, type: 'enum', enum: Gender })
  gender?: `${Gender}`;

  @Column({ nullable: true, type: 'varchar' })
  state_of_origin?: string;

  @Column({ nullable: true, type: 'varchar' })
  lga?: string;

  @Column({ nullable: true, type: 'varchar' })
  nationality?: string;

  @Column({ nullable: true, type: 'enum', enum: EmploymentStatus })
  employment_status?: `${EmploymentStatus}`;

  // Employed fields
  @Column({ nullable: true, type: 'varchar' })
  employer_name?: string;

  @Column({ nullable: true, type: 'varchar' })
  job_title?: string;

  @Column({ nullable: true, type: 'varchar' })
  employer_address?: string;

  @Column({ nullable: true, type: 'float' })
  monthly_income?: number;

  @Column({ nullable: true, type: 'varchar' })
  work_email?: string;

  // Self-employed fields
  @Column({ nullable: true, type: 'varchar' })
  business_name?: string;

  @Column({ nullable: true, type: 'varchar' })
  nature_of_business?: string;

  @Column({ nullable: true, type: 'varchar' })
  business_address?: string;

  @Column({ nullable: true, type: 'float' })
  business_monthly_income?: number;

  @Column({ nullable: true, type: 'varchar' })
  business_website?: string;

  @Column({ nullable: true, type: 'enum', enum: MaritalStatus })
  marital_status?: `${MaritalStatus}`;

  // Spouse info (if married)
  @Column({ nullable: true, type: 'varchar' })
  spouse_full_name?: string;

  @Column({ nullable: true, type: 'varchar' })
  spouse_phone_number?: string;

  @Column({ nullable: true, type: 'varchar' })
  spouse_occupation?: string;

  @Column({ nullable: true, type: 'varchar' })
  spouse_employer?: string;

  @Column({ nullable: true, type: 'varchar' })
  source_of_funds?: string;

  @Column({ nullable: true, type: 'float' })
  monthly_income_estimate?: number;

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

  @OneToOne(() => TenantKyc, (tenant_kyc) => tenant_kyc.user)
  tenant_kyc?: TenantKyc;

  @BeforeInsert()
  @BeforeUpdate()
  normalizePhone() {
    if (this.phone_number) {
      this.phone_number = normalizePhoneNumber(this.phone_number);
    }
    if (this.spouse_phone_number) {
      this.spouse_phone_number = normalizePhoneNumber(this.spouse_phone_number);
    }
  }
}
