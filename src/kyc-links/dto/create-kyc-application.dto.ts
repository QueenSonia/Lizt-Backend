import { IsString, IsNotEmpty, IsNumberString } from 'class-validator';
import { BaseKYCApplicationFieldsDto } from './base-kyc-application-fields.dto';

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
}
