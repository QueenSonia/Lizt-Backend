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
 * DTO for KYC Application submission
 *
 * All user-facing fields are required except referral_agent and additional_notes.
 * Employment-specific fields are conditionally required based on employment_status.
 * SECURITY: KYC token is now in request body to prevent exposure in logs
 */
export class CreateKYCApplicationDto {
  // SECURITY: KYC token (in body, not URL to prevent exposure)
  @IsString()
  @IsNotEmpty()
  kyc_token: string;

  // Property Selection
  @IsString()
  @IsNotEmpty()
  property_id: string;

  // Personal Information
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsNotEmpty()
  @IsEmail()
  email: string;

  @IsNotEmpty()
  @IsString()
  contact_address: string;

  @IsPhoneNumber('NG')
  @IsNotEmpty()
  @NormalizePhoneNumber()
  phone_number: string;

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
  nationality: string;

  @IsNotEmpty()
  @IsString()
  state_of_origin: string;

  /**
   * Can either be: "single", "married", "divorced", or "widowed".
   * @example single
   */
  @IsNotEmpty()
  @IsIn(Object.values(MaritalStatus))
  marital_status: MaritalStatus;

  /**
   * Can either be: "employed", "self-employed", "unemployed", or "student".
   * @example employed
   */
  @IsNotEmpty()
  @IsIn(Object.values(EmploymentStatus))
  employment_status: EmploymentStatus;

  // Employment fields - required if employed
  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNotEmpty()
  @IsString()
  occupation?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNotEmpty()
  @IsString()
  job_title?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNotEmpty()
  @IsString()
  employer_name?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNotEmpty()
  @IsString()
  work_address?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNotEmpty()
  @IsNumberString()
  monthly_net_income?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNotEmpty()
  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  work_phone_number?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsNotEmpty()
  @IsString()
  length_of_employment?: string;

  // Next of Kin Information
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

  // Referral Agent Information (optional)
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

  // Self-Employed Specific Fields - required if self-employed
  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsNotEmpty()
  @IsString()
  nature_of_business?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsNotEmpty()
  @IsString()
  business_name?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsNotEmpty()
  @IsString()
  business_address?: string;

  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsNotEmpty()
  @IsString()
  business_duration?: string;

  // Tenancy Information
  @IsNotEmpty()
  @IsString()
  intended_use_of_property: string;

  @IsNotEmpty()
  @IsNumberString()
  number_of_occupants: string;

  @IsOptional()
  @IsString()
  parking_needs?: string;

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

  // Tracking Information (optional - captured from request)
  @IsOptional()
  @IsString()
  decision_made_ip?: string;
}
