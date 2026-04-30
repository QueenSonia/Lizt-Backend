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
  IsUrl,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  EmploymentStatus,
  Gender,
  MaritalStatus,
} from '../../tenant-kyc/entities/tenant-kyc.entity';
import { NormalizePhoneNumber } from '../../utils/phone-number.transformer';

/**
 * Base DTO containing all fields shared between KYC submission flows.
 * Extended by CreateKYCApplicationDto (full submission) and CompleteKYCDto (completion).
 */
export class BaseKYCApplicationFieldsDto {
  // SECURITY: KYC token (in body, not URL to prevent exposure)
  @IsString()
  @IsNotEmpty()
  kyc_token: string;

  // Personal Information
  @IsPhoneNumber('NG')
  @IsNotEmpty()
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

  @IsNotEmpty()
  @IsString()
  religion: string;

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

  // Referral Agent Information (required)
  @IsString()
  @IsNotEmpty()
  referral_agent_full_name: string;

  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  referral_agent_phone_number: string;

  // Tenancy Information
  @IsOptional()
  @IsString()
  intended_use_of_property?: string;

  @IsOptional()
  @IsNumberString()
  number_of_occupants?: string;

  @IsOptional()
  @IsString()
  parking_needs?: string;

  @IsOptional()
  @IsNumberString()
  proposed_rent_amount?: string;

  @IsOptional()
  @IsString()
  rent_payment_frequency?: string;

  @IsOptional()
  @IsString()
  additional_notes?: string;

  // Tracking fields (captured client-side, sent with submission)
  @IsOptional()
  @IsString()
  form_opened_at?: string;

  @IsOptional()
  @IsString()
  form_opened_ip?: string;

  @IsOptional()
  @IsString()
  decision_made_ip?: string;

  @IsOptional()
  @IsString()
  user_agent?: string;

  // Per-view tracking: every form mount in the applicant's session is captured
  // client-side and sent here at submit time, so each view becomes one
  // PropertyHistory row attributed to the submitting applicant.
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => KYCViewEventDto)
  view_events?: KYCViewEventDto[];

  // Document URLs (from Cloudinary - always https://)
  @IsUrl(
    { require_protocol: true },
    { message: 'passport_photo_url must be a valid URL' },
  )
  @IsNotEmpty()
  passport_photo_url: string;

  @IsUrl(
    { require_protocol: true },
    { message: 'id_document_url must be a valid URL' },
  )
  @IsNotEmpty()
  id_document_url: string;

  // Employment proof is required if employment_status is "employed"
  @ValidateIf((o) => o.employment_status === EmploymentStatus.EMPLOYED)
  @IsUrl(
    { require_protocol: true },
    { message: 'employment_proof_url must be a valid URL' },
  )
  @IsNotEmpty()
  employment_proof_url?: string;

  // Business proof is required if employment_status is "self-employed"
  @ValidateIf((o) => o.employment_status === EmploymentStatus.SELF_EMPLOYED)
  @IsUrl(
    { require_protocol: true },
    { message: 'business_proof_url must be a valid URL' },
  )
  @IsNotEmpty()
  business_proof_url?: string;
}

export class KYCViewEventDto {
  @IsDateString()
  at: string;

  @IsOptional()
  @IsString()
  ip?: string;

  @IsOptional()
  @IsString()
  ua?: string;
}
