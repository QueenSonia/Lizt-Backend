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

export class CreateTenantKycDto {
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  /**
   * Email will be required when phone number is not provided
   * @example sewkito@gmail.com
   */
  @ValidateIf((o) => !o.phone_number?.trim())
  @IsEmail()
  @IsOptional()
  email?: string;

  /**
   * Phone number will be required when email is not provided
   * @example +2348148696119
   */
  @ValidateIf((o) => !o.email?.trim())
  @IsPhoneNumber('NG')
  @IsOptional()
  phone_number?: string;

  /**
   * @example 1996-04-22T11:03:13.157Z
   */
  @IsOptional()
  @IsDateString()
  date_of_birth?: string;

  /**
   * Can either be: "male", "female", or "other".
   * @example male
   */
  @IsIn(Object.values(Gender))
  gender: `${Gender}`;

  @IsString()
  nationality: string;

  @IsString()
  @IsOptional()
  current_residence?: string;

  @IsString()
  state_of_origin: string;

  @IsString()
  local_government_area: string;

  /**
   * Can either be: "single", "married", "divorced", or "widowed".
   * @example single
   */
  @IsIn(Object.values(MaritalStatus))
  marital_status: `${MaritalStatus}`;

  @IsOptional()
  @IsString()
  religion?: string;

  @IsOptional()
  @IsString()
  spouse_name_and_contact?: string;

  /**
   * Can either be: "employed", "self-employed", "unemployed", or "student".
   * @example employed
   */
  @IsIn(Object.values(EmploymentStatus))
  employment_status: `${EmploymentStatus}`;

  @IsString()
  occupation: string;

  /** Only required when `employment_status` is `employed` */
  @ValidateIf((o) => o.employment_status === 'employed')
  @IsString()
  @IsOptional()
  job_title?: string;

  /** Only required when `employment_status` is `employed` */
  @ValidateIf((o) => o.employment_status === 'employed')
  @IsString()
  @IsOptional()
  employer_name?: string;

  /** Only required when `employment_status` is `employed` */
  @ValidateIf((o) => o.employment_status === 'employed')
  @IsString()
  @IsOptional()
  employer_address?: string;

  /** Only required when `employment_status` is `employed` */
  @ValidateIf((o) => o.employment_status === 'employed')
  @IsOptional()
  @IsPhoneNumber('NG')
  employer_phone_number?: string;

  @IsNumberString()
  monthly_net_income: string;

  @IsString()
  reference1_name: string;

  @IsString()
  reference1_address: string;

  @IsString()
  reference1_relationship: string;

  @IsPhoneNumber('NG')
  reference1_phone_number: string;

  @IsOptional()
  @IsString()
  reference2_name?: string;

  @IsOptional()
  @IsString()
  reference2_address?: string;

  @IsOptional()
  @IsString()
  reference2_relationship?: string;

  @IsOptional()
  // @IsPhoneNumber('NG')
  reference2_phone_number?: string;

  @IsUUID()
  landlord_id: string;
}
