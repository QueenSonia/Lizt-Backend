import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsDateString,
  IsOptional,
  IsPhoneNumber,
  IsNumberString,
  ValidateIf,
  IsUUID,
  IsIn,
} from 'class-validator';

import {
  EmploymentStatus,
  Gender,
  MaritalStatus,
} from '../entities/tenant-kyc.entity';
import { NormalizePhoneNumber } from '../../utils/phone-number.transformer';

export class CreateTenantKycDto {
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  /**
   * Email will be required when phone number is ——
   * @example sewkito@gmail.com
   */
  @ValidateIf((o) => !o.phone_number?.trim())
  @IsEmail()
  email?: string;

  /**
   * Phone number will be required when email is ——
   * @example +2348148696119
   */
  @ValidateIf((o) => !o.email?.trim())
  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  phone_number?: string;

  /**
   * @example 1996-04-22T11:03:13.157Z
   */
  @IsNotEmpty()
  @IsDateString()
  date_of_birth: string;

  /**
   * Can either be: "male", "female", or "other".
   * @example male
   */
  @IsNotEmpty()
  @IsIn(Object.values(Gender))
  gender: `${Gender}`;

  @IsNotEmpty()
  @IsString()
  nationality: string;

  @IsNotEmpty()
  @IsString()
  current_residence: string;

  @IsNotEmpty()
  @IsString()
  state_of_origin: string;

  /**
   * Can either be: "single", "married", "divorced", or "widowed".
   * @example single
   */
  @IsNotEmpty()
  @IsIn(Object.values(MaritalStatus))
  marital_status: `${MaritalStatus}`;

  @IsNotEmpty()
  @IsString()
  religion: string;

  @ValidateIf((o) => o.marital_status === MaritalStatus.MARRIED)
  @IsNotEmpty()
  @IsString()
  spouse_name_and_contact?: string;

  /**
   * Can either be: "employed", "self-employed", "unemployed", or "student".
   * @example employed
   */
  @IsNotEmpty()
  @IsIn(Object.values(EmploymentStatus))
  employment_status: `${EmploymentStatus}`;

  @IsNotEmpty()
  @IsString()
  occupation: string;

  /** Only required when `employment_status` is `employed` */
  @ValidateIf((o) => o.employment_status === 'employed')
  @IsString()
  @IsNotEmpty()
  job_title?: string;

  /** Only required when `employment_status` is `employed` */
  @ValidateIf((o) => o.employment_status === 'employed')
  @IsString()
  @IsNotEmpty()
  employer_name?: string;

  /** Only required when `employment_status` is `employed` */
  @ValidateIf((o) => o.employment_status === 'employed')
  @IsString()
  @IsNotEmpty()
  work_address?: string;

  /** Only required when `employment_status` is `employed` */
  @ValidateIf((o) => o.employment_status === 'employed')
  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  @IsNotEmpty()
  work_phone_number?: string;

  @IsNotEmpty()
  @IsNumberString()
  monthly_net_income: string;

  /** Only required when `employment_status` is `self-employed` */
  @ValidateIf((o) => o.employment_status === 'self-employed')
  @IsString()
  @IsNotEmpty()
  nature_of_business?: string;

  /** Only required when `employment_status` is `self-employed` */
  @ValidateIf((o) => o.employment_status === 'self-employed')
  @IsString()
  @IsNotEmpty()
  business_name?: string;

  /** Only required when `employment_status` is `self-employed` */
  @ValidateIf((o) => o.employment_status === 'self-employed')
  @IsString()
  @IsNotEmpty()
  business_address?: string;

  /** Only required when `employment_status` is `self-employed` */
  @ValidateIf((o) => o.employment_status === 'self-employed')
  @IsString()
  @IsNotEmpty()
  business_duration?: string;

  @ValidateIf((o) => o.employment_status === 'self-employed')
  @IsString()
  @IsNotEmpty()
  estimated_monthly_income?: string;

  @IsNotEmpty()
  @IsString()
  contact_address: string;

  @IsNotEmpty()
  @IsString()
  next_of_kin_full_name: string;

  @IsNotEmpty()
  @IsString()
  next_of_kin_address: string;

  @IsNotEmpty()
  @IsString()
  next_of_kin_relationship: string;

  @IsNotEmpty()
  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  next_of_kin_phone_number: string;

  @IsNotEmpty()
  @IsEmail()
  next_of_kin_email: string;

  @IsString()
  @IsNotEmpty()
  referral_agent_full_name: string;

  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  referral_agent_phone_number: string;

  @IsUUID()
  landlord_id: string;
}
