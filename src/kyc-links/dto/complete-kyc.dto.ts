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
  Length,
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
 * SECURITY: Requires KYC token and OTP verification to prevent unauthorized completion
 *
 * All user-facing fields are required except referral_agent and additional_notes.
 * Employment-specific fields are conditionally required based on employment_status.
 */
export class CompleteKYCDto {
  // SECURITY: KYC token (in body, not URL to prevent exposure)
  @IsNotEmpty()
  @IsString()
  kyc_token: string;

  // SECURITY: OTP verification required
  @IsNotEmpty()
  @IsString()
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  otp: string;

  @IsNotEmpty()
  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  phone_number: string;

  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  contact_address: string;

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
  @IsNotEmpty()
  work_phone_number?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsString()
  @IsNotEmpty()
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
  @IsNotEmpty()
  business_duration?: string;

  // Next of Kin
  @IsNotEmpty()
  @IsString()
  next_of_kin_full_name: string;

  @IsNotEmpty()
  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  next_of_kin_phone_number: string;

  @IsNotEmpty()
  @IsString()
  next_of_kin_relationship: string;

  @IsNotEmpty()
  @IsString()
  next_of_kin_address: string;

  @IsNotEmpty()
  @IsEmail()
  next_of_kin_email: string;

  // Referral Agent (optional)
  @IsOptional()
  @IsString()
  referral_agent_full_name?: string;

  @IsOptional()
  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  referral_agent_phone_number?: string;

  // Additional Personal Information
  @IsNotEmpty()
  @IsString()
  religion: string;

  // Tenancy Information
  @IsNotEmpty()
  @IsString()
  intended_use_of_property: string;

  @IsNotEmpty()
  @IsNumberString()
  number_of_occupants: string;

  @IsNotEmpty()
  @IsNumberString()
  proposed_rent_amount: string;

  @IsNotEmpty()
  @IsString()
  rent_payment_frequency: string;

  @IsOptional()
  @IsString()
  additional_notes?: string;

  // Document URLs (from Cloudinary)
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
