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

/**
 * DTO for KYC Application submission
 *
 * NOTE: Validation has been relaxed - only names and phone number are required.
 * Most fields have been made optional and can be re-enabled later by removing @IsOptional decorators.
 */
export class CreateKYCApplicationDto {
  // Personal Information - Only names and phone are required for relaxed validation
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsPhoneNumber('NG')
  @IsNotEmpty()
  phone_number: string;

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
  @IsOptional()
  @IsIn(Object.values(Gender))
  gender?: Gender;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  state_of_origin?: string;

  @IsOptional()
  @IsString()
  local_government_area?: string;

  /**
   * Can either be: "single", "married", "divorced", or "widowed".
   * @example single
   */
  @IsOptional()
  @IsIn(Object.values(MaritalStatus))
  marital_status?: MaritalStatus;

  // Employment Information - All made optional for relaxed validation
  /**
   * Can either be: "employed", "self-employed", "unemployed", or "student".
   * @example employed
   */
  @IsOptional()
  @IsIn(Object.values(EmploymentStatus))
  employment_status?: EmploymentStatus;

  @IsOptional()
  @IsString()
  occupation?: string;

  @IsOptional()
  @IsString()
  job_title?: string;

  // Employment Information - All made optional
  @IsOptional()
  @IsString()
  employer_name?: string;

  @IsOptional()
  @IsString()
  employer_address?: string;

  @IsOptional()
  @IsNumberString()
  monthly_net_income?: string;

  // References - All made optional for relaxed validation
  @IsOptional()
  @IsString()
  reference1_name?: string;

  @IsOptional()
  @IsString()
  reference1_address?: string;

  @IsOptional()
  @IsString()
  reference1_relationship?: string;

  @IsOptional()
  @IsPhoneNumber('NG')
  reference1_phone_number?: string;

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
