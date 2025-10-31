import { Column, Entity, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../../base.entity';
import { Property } from '../../properties/entities/property.entity';
import { Account } from '../../users/entities/account.entity';
import { KYCLink } from './kyc-link.entity';
import {
  Gender,
  MaritalStatus,
  EmploymentStatus,
} from '../../tenant-kyc/entities/tenant-kyc.entity';

export enum ApplicationStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

@Entity({ name: 'kyc_applications' })
export class KYCApplication extends BaseEntity {
  @Column({ type: 'uuid' })
  kyc_link_id: string;

  @Column({ type: 'uuid' })
  property_id: string;

  @Column({
    type: 'enum',
    enum: ApplicationStatus,
    default: ApplicationStatus.PENDING,
  })
  status: ApplicationStatus;

  @Column({ type: 'uuid', nullable: true })
  tenant_id?: string;

  // Personal Information
  @Column({ type: 'varchar' })
  first_name: string;

  @Column({ type: 'varchar' })
  last_name: string;

  @Column({ type: 'varchar' })
  email: string;

  @Column({ type: 'varchar' })
  phone_number: string;

  @Column({ type: 'date' })
  date_of_birth: Date;

  @Column({ type: 'enum', enum: Gender })
  gender: Gender;

  @Column({ type: 'varchar' })
  nationality: string;

  @Column({ type: 'varchar' })
  state_of_origin: string;

  @Column({ type: 'varchar' })
  local_government_area: string;

  @Column({ type: 'enum', enum: MaritalStatus })
  marital_status: MaritalStatus;

  // Employment Information
  @Column({ type: 'enum', enum: EmploymentStatus })
  employment_status: EmploymentStatus;

  @Column({ type: 'varchar' })
  occupation: string;

  @Column({ type: 'varchar' })
  job_title: string;

  @Column({ type: 'varchar', nullable: true })
  employer_name?: string;

  @Column({ type: 'varchar', nullable: true })
  employer_address?: string;

  @Column({ type: 'varchar' })
  monthly_net_income: string;

  // References
  @Column({ type: 'varchar' })
  reference1_name: string;

  @Column({ type: 'varchar' })
  reference1_address: string;

  @Column({ type: 'varchar' })
  reference1_relationship: string;

  @Column({ type: 'varchar' })
  reference1_phone_number: string;

  @Column({ type: 'varchar', nullable: true })
  reference2_name?: string;

  @Column({ type: 'varchar', nullable: true })
  reference2_address?: string;

  @Column({ type: 'varchar', nullable: true })
  reference2_relationship?: string;

  @Column({ type: 'varchar', nullable: true })
  reference2_phone_number?: string;

  @ManyToOne(() => KYCLink, (kycLink) => kycLink.applications)
  @JoinColumn({ name: 'kyc_link_id' })
  kyc_link: KYCLink;

  @ManyToOne(() => Property, (property) => property.kyc_applications)
  @JoinColumn({ name: 'property_id' })
  property: Property;

  @ManyToOne(() => Account, { nullable: true })
  @JoinColumn({ name: 'tenant_id' })
  tenant?: Account;
}
