import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsNumberString,
} from 'class-validator';
import { BaseKYCApplicationFieldsDto } from './base-kyc-application-fields.dto';

/**
 * DTO for Property Addition KYC submission.
 * Extends base DTO but makes tenancy fields optional since they're not required
 * for existing tenants being added to new properties.
 */
export class PropertyAdditionKYCDto extends BaseKYCApplicationFieldsDto {
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

  // Override tenancy fields to be optional for property addition
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
}
