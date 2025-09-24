import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  Index,
} from 'typeorm';

import { Users } from 'src/users/entities/user.entity';
import { BaseEntity } from 'src/base.entity';

export enum Gender {
  MALE = 'male',
  FEMALE = 'female',
  OTHER = 'other',
}

export enum MaritalStatus {
  SINGLE = 'single',
  MARRIED = 'married',
  DIVORCED = 'divorced',
  WIDOWED = 'widowed',
}

export enum EmploymentStatus {
  EMPLOYED = 'employed',
  SELF_EMPLOYED = 'self-employed',
  UNEMPLOYED = 'unemployed',
  STUDENT = 'student',
}

// @Index(
//   'unique_identity',
//   ['first_name', 'last_name', 'date_of_birth', 'email', 'phone_number'],
//   { unique: true },
// ) // I'd only use this unique index if I'm sure that there'll always be email and phone number. But for now, this approach won't be so reliable, so I'll stick with using identity hash.
@Entity('tenant_kyc')
export class TenantKyc extends BaseEntity {
  @Column({ type: 'varchar' })
  first_name: string;

  @Column({ type: 'varchar' })
  last_name: string;

  @Column({ type: 'varchar', nullable: true })
  email: string;

  @Column({ type: 'varchar', nullable: true })
  phone_number: string;

  @Column({ type: 'date' })
  date_of_birth: Date;

  @Column({ type: 'enum', enum: Gender })
  gender: `${Gender}`;

  @Column({ type: 'varchar' })
  nationality: string;

  @Column({ type: 'varchar', nullable: true })
  current_residence: string;

  @Column({ type: 'varchar' })
  state_of_origin: string;

  @Column({ type: 'varchar' })
  local_government_area: string;

  @Column({ type: 'enum', enum: MaritalStatus })
  marital_status: `${MaritalStatus}`;

  @Column({ type: 'varchar', nullable: true })
  religion: string;

  @Column({ type: 'varchar', nullable: true })
  spouse_name_and_contact: string;

  @Column({ type: 'enum', enum: EmploymentStatus })
  employment_status: `${EmploymentStatus}`;

  @Column({ type: 'varchar' })
  occupation: string;

  @Column({ type: 'varchar' })
  job_title: string;

  @Column({ type: 'varchar', nullable: true })
  employer_name: string;

  @Column({ type: 'varchar', nullable: true })
  employer_address: string;

  @Column({ type: 'varchar', nullable: true })
  employer_phone_number: string;

  @Column({ type: 'varchar' })
  monthly_net_income: string;

  @Column({ type: 'varchar' })
  reference1_name: string;

  @Column({ type: 'varchar' })
  reference1_address: string;

  @Column({ type: 'varchar' })
  reference1_relationship: string;

  @Column({ type: 'varchar' })
  reference1_phone_number: string;

  @Column({ type: 'varchar', nullable: true })
  reference2_name: string;

  @Column({ type: 'varchar', nullable: true })
  reference2_address: string;

  @Column({ type: 'varchar', nullable: true })
  reference2_relationship: string;

  @Column({ type: 'varchar', nullable: true })
  reference2_phone_number: string;

  @Column({ nullable: true, type: 'uuid' })
  user_id?: string;

  @OneToOne(() => Users, (user) => user.tenant_kyc, { cascade: ['remove'] })
  user?: Users;

  @Column({ type: 'uuid' })
  admin_id: string;

  @OneToOne(() => Users, (user) => user.tenant_kyc)
  admin?: Users;

  @Column({ unique: true, type: 'varchar', length: 64 })
  identity_hash: string;

  toJSON() {
    const kyc = this as any;

    delete kyc.admin_id;
    delete kyc.user_id;
    delete kyc.identity_hash;
    delete kyc.updated_at;

    return kyc;
  }
}
