import {
  IsString,
  IsEmail,
  IsNotEmpty,
  IsDateString,
  IsOptional,
  IsPhoneNumber,
  IsNumberString,
  ValidateIf,
  IsIn,
} from 'class-validator';

import {
  EmploymentStatus,
  Gender,
  MaritalStatus,
} from '../../tenant-kyc/entities/tenant-kyc.entity';

export class CreateKYCApplicationDto {
  // Personal Information
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsEmail()
  @IsNotEmpty()
  email: string;

  @IsPhoneNumber('NG')
  @IsNotEmpty()
  phone_number: string;

  /**
   * @example 1996-04-22T11:03:13.157Z
   */
  @IsDateString()
  @IsNotEmpty()
  date_of_birth: string;

  /**
   * Can either be: "male", "female", or "other".
   * @example male
   */
  @IsIn(Object.values(Gender))
  gender: Gender;

  @IsString()
  @IsNotEmpty()
  nationality: string;

  @IsString()
  @IsNotEmpty()
  state_of_origin: string;

  @IsString()
  @IsNotEmpty()
  local_government_area: string;

  /**
   * Can either be: "single", "married", "divorced", or "widowed".
   * @example single
   */
  @IsIn(Object.values(MaritalStatus))
  marital_status: MaritalStatus;

  // Employment Information
  /**
   * Can either be: "employed", "self-employed", "unemployed", or "student".
   * @example employed
   */
  @IsIn(Object.values(EmploymentStatus))
  employment_status: EmploymentStatus;

  @IsString()
  @IsNotEmpty()
  occupation: string;

  @IsString()
  @IsNotEmpty()
  job_title: string;

  /** Only required when `employment_status` is `employed` */
  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsString()
  @IsOptional()
  employer_name?: string;

  /** Only required when `employment_status` is `employed` */
  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsString()
  @IsOptional()
  employer_address?: string;

  @IsNumberString()
  @IsNotEmpty()
  monthly_net_income: string;

  // References
  @IsString()
  @IsNotEmpty()
  reference1_name: string;

  @IsString()
  @IsNotEmpty()
  reference1_address: string;

  @IsString()
  @IsNotEmpty()
  reference1_relationship: string;

  @IsPhoneNumber('NG')
  @IsNotEmpty()
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
  @IsPhoneNumber('NG')
  reference2_phone_number?: string;
}
