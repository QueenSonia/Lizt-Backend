import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OnboardingOccupancyStatus } from '../entities/landlord-onboarding-property.entity';

export class OnboardingDocumentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  url: string;

  @IsOptional()
  @IsString()
  size?: string;
}

export class OnboardingPropertyDto {
  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  @IsEnum(OnboardingOccupancyStatus)
  occupancy_status: OnboardingOccupancyStatus;

  // ---- Occupied-only fields ----
  @ValidateIf((o) => o.occupancy_status === OnboardingOccupancyStatus.OCCUPIED)
  @IsNumber()
  rent: number;

  @IsOptional()
  @IsNumber()
  service_charge?: number;

  @ValidateIf((o) => o.occupancy_status === OnboardingOccupancyStatus.OCCUPIED)
  @IsString()
  @IsNotEmpty()
  tenant_first_name: string;

  @ValidateIf((o) => o.occupancy_status === OnboardingOccupancyStatus.OCCUPIED)
  @IsString()
  @IsNotEmpty()
  tenant_last_name: string;

  @ValidateIf((o) => o.occupancy_status === OnboardingOccupancyStatus.OCCUPIED)
  @IsString()
  @IsNotEmpty()
  tenant_phone: string;

  @IsOptional()
  @IsEmail()
  tenant_email?: string;

  @ValidateIf((o) => o.occupancy_status === OnboardingOccupancyStatus.OCCUPIED)
  @IsString()
  @IsNotEmpty()
  tenancy_type: string;

  @ValidateIf((o) => o.tenancy_type === 'Custom')
  @IsString()
  @IsNotEmpty()
  custom_duration?: string;

  @ValidateIf((o) => o.occupancy_status === OnboardingOccupancyStatus.OCCUPIED)
  @IsString()
  @IsNotEmpty()
  tenancy_start_date: string;

  @ValidateIf((o) => o.occupancy_status === OnboardingOccupancyStatus.OCCUPIED)
  @IsString()
  @IsNotEmpty()
  tenancy_end_date: string;

  // At least one document is required for occupied properties.
  @ValidateIf((o) => o.occupancy_status === OnboardingOccupancyStatus.OCCUPIED)
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OnboardingDocumentDto)
  documents: OnboardingDocumentDto[];
}

export class SubmitOnboardingDto {
  // Token in the body (kept out of URL logs), mirroring `kyc/submit`.
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsOptional()
  @IsString()
  country_code?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OnboardingPropertyDto)
  properties: OnboardingPropertyDto[];
}
