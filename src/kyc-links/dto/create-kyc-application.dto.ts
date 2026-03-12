import { IsString, IsNotEmpty } from 'class-validator';
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
}
