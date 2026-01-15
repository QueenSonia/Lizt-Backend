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
import { NormalizePhoneNumber } from '../../utils/phone-number.transformer';

/**
 * DTO for completing a pending KYC application
 * Used when a tenant completes their KYC after landlord has pre-filled basic information
 */
export class CompleteKYCDto {
  // Email is optional and editable even if pre-filled
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  contact_address?: string;

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
  gender: Gender;

  @IsNotEmpty()
  @IsString()
  state_of_origin: string;

  @IsNotEmpty()
  @IsString()
  nationality: string;

  /**
   * Can either be: "employed", "self-employed", "unemployed", or "student".
   * @example employed
   */
  @IsNotEmpty()
  @IsIn(Object.values(EmploymentStatus))
  employment_status: EmploymentStatus;

  /**
   * Can either be: "single", "married", "divorced", or "widowed".
   * @example single
   */
  @IsNotEmpty()
  @IsIn(Object.values(MaritalStatus))
  marital_status: MaritalStatus;

  // Employment Information - Required if employed
  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsString()
  @IsNotEmpty()
  occupation?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsString()
  @IsNotEmpty()
  job_title?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsString()
  @IsNotEmpty()
  employer_name?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsString()
  @IsNotEmpty()
  work_address?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNumberString()
  @IsNotEmpty()
  monthly_net_income?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  @IsOptional()
  work_phone_number?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsString()
  @IsOptional()
  length_of_employment?: string;

  // Self-Employed Specific Fields - Required if self-employed
  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsString()
  @IsNotEmpty()
  nature_of_business?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsString()
  @IsNotEmpty()
  business_name?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsString()
  @IsNotEmpty()
  business_address?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsString()
  @IsOptional()
  business_duration?: string;

  // Next of Kin - Optional
  @IsOptional()
  @IsString()
  next_of_kin_full_name?: string;

  @IsOptional()
  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  next_of_kin_phone_number?: string;

  @IsOptional()
  @IsString()
  next_of_kin_relationship?: string;

  @IsOptional()
  @IsString()
  next_of_kin_address?: string;

  @IsOptional()
  @IsEmail()
  next_of_kin_email?: string;

  // Referral Agent - Optional
  @IsOptional()
  @IsString()
  referral_agent_full_name?: string;

  @IsOptional()
  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  referral_agent_phone_number?: string;

  // Additional Personal Information
  @IsOptional()
  @IsString()
  religion?: string;

  // Tenancy Information
  @IsOptional()
  @IsString()
  intended_use_of_property?: string;

  @IsOptional()
  @IsNumberString()
  number_of_occupants?: string;

  @IsOptional()
  @IsNumberString()
  proposed_rent_amount?: string;

  @IsOptional()
  @IsString()
  rent_payment_frequency?: string;

  @IsOptional()
  @IsString()
  additional_notes?: string;

  // Document URLs (from Cloudinary) - Required documents
  @IsString()
  @IsNotEmpty()
  passport_photo_url: string;

  @IsString()
  @IsNotEmpty()
  id_document_url: string;

  // Employment proof is required if employment_status is "employed"
  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsString()
  @IsNotEmpty()
  employment_proof_url?: string;

  // Business proof is required if employment_status is "self-employed"
  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsString()
  @IsNotEmpty()
  business_proof_url?: string;
}
