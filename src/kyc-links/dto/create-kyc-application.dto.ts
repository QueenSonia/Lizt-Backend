import {
  IsString,
  IsNotEmpty,
  IsNumberString,
  IsOptional,
  IsBoolean,
  IsPhoneNumber,
} from 'class-validator';
import { BaseKYCApplicationFieldsDto } from './base-kyc-application-fields.dto';
import { NormalizePhoneNumber } from '../../utils/phone-number.transformer';

/**
 * DTO for KYC Application submission (full submission by tenant).
 * Extends the shared base with submit-specific fields.
 *
 * SECURITY: KYC token is now in request body to prevent exposure in logs
 */
export class CreateKYCApplicationDto extends BaseKYCApplicationFieldsDto {
  // Property Selection
  @IsString()
  @IsNotEmpty()
  property_id: string;

  // Personal Information (pre-filled by tenant in this flow)
  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  // Tenancy fields required in full submission flow
  @IsString()
  @IsNotEmpty()
  intended_use_of_property: string;

  @IsNumberString()
  @IsNotEmpty()
  number_of_occupants: string;

  @IsNumberString()
  @IsNotEmpty()
  proposed_rent_amount: string;

  @IsString()
  @IsNotEmpty()
  rent_payment_frequency: string;

  // Referral agent fields are required for the new-tenant flow (Step 3 is shown).
  @IsString()
  @IsNotEmpty()
  referral_agent_full_name: string;

  @IsNotEmpty()
  @IsPhoneNumber('NG')
  @NormalizePhoneNumber()
  referral_agent_phone_number: string;

  // Set true on a retry after the applicant confirmed they want to overwrite
  // their existing PENDING application for this property. Without it, the
  // service throws PENDING_APPLICATION_EXISTS so the frontend can prompt.
  @IsOptional()
  @IsBoolean()
  update_existing?: boolean;
}
