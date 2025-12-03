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
 * NOTE: Validation has been relaxed - only names and phone number are required.
 * Most fields have been made optional and can be re-enabled later by removing @IsOptional decorators.
 */
export class CreateKYCApplicationDto {
  // Property Selection - Required field for new general link system
  @IsString()
  @IsNotEmpty()
  property_id: string;

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

  @IsOptional()
  @IsString()
  contact_address?: string;

  @IsPhoneNumber('NG')
  @IsNotEmpty()
  @NormalizePhoneNumber()
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
  @NormalizePhoneNumber()
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
  @NormalizePhoneNumber()
  reference2_phone_number?: string;

  // Additional Personal Information
  @IsOptional()
  @IsString()
  religion?: string;

  // Additional Reference Information
  @IsOptional()
  @IsEmail()
  reference1_email?: string;

  // Additional Employment Information
  @IsOptional()
  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  employer_phone_number?: string;

  @IsOptional()
  @IsString()
  length_of_employment?: string;

  // Self-Employed Specific Fields
  @IsOptional()
  @IsString()
  nature_of_business?: string;

  @IsOptional()
  @IsString()
  business_name?: string;

  @IsOptional()
  @IsString()
  business_address?: string;

  @IsOptional()
  @IsString()
  business_duration?: string;

  // Tenancy Information
  @IsOptional()
  @IsString()
  intended_use_of_property?: string;

  @IsOptional()
  @IsNumberString()
  number_of_occupants?: string;

  @IsOptional()
  @IsNumberString()
  number_of_cars_owned?: string;

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
