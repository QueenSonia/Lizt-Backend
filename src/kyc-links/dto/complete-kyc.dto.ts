import { IsString, IsNotEmpty, IsNumberString } from 'class-validator';
import { BaseKYCApplicationFieldsDto } from './base-kyc-application-fields.dto';

/**
 * DTO for completing a pending KYC application.
 * Used when a tenant completes their KYC after landlord has pre-filled basic information.
 *
 * SECURITY: Requires KYC token and OTP verification (checked via DB lookup in the service)
 * to prevent unauthorized completion.
 *
 * All fields are inherited from BaseKYCApplicationFieldsDto.
 */
export class CompleteKYCDto extends BaseKYCApplicationFieldsDto {
  // Tenancy fields required in full completion flow
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
