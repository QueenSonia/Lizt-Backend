import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { OnboardingOccupancyStatus } from '../entities/landlord-onboarding-property.entity';
import { LandlordType } from '../../users/entities/account.entity';

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

  // Proof of ownership — required for every property (occupied or vacant).
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OnboardingDocumentDto)
  ownership_documents: OnboardingDocumentDto[];

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
  // Link token — optional; the authoritative one comes from the verified claim
  // (OnboardingVerifiedGuard). Kept for tolerance with older clients.
  @IsOptional()
  @IsString()
  token?: string;

  // OTP verification JWT, read by OnboardingVerifiedGuard from the body (the
  // Next.js proxy drops client-set Authorization headers).
  @IsOptional()
  @IsString()
  verificationToken?: string;

  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  // Phone + country_code come from the verified claim; kept optional/ignored.
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  country_code?: string;

  // ---- Landlord type + identification ----
  @IsEnum(LandlordType)
  landlord_type: LandlordType;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsString()
  @IsNotEmpty()
  address: string;

  // Individual-only
  @ValidateIf((o) => o.landlord_type === LandlordType.INDIVIDUAL)
  @IsString()
  @IsNotEmpty()
  date_of_birth?: string;

  @ValidateIf((o) => o.landlord_type === LandlordType.INDIVIDUAL)
  @IsString()
  @IsNotEmpty()
  employment_status?: string;

  @ValidateIf((o) => o.landlord_type === LandlordType.INDIVIDUAL)
  @IsString()
  @IsNotEmpty()
  id_type?: string;

  @ValidateIf((o) => o.landlord_type === LandlordType.INDIVIDUAL)
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OnboardingDocumentDto)
  id_documents?: OnboardingDocumentDto[];

  // Corporate-only
  @ValidateIf((o) => o.landlord_type === LandlordType.CORPORATE)
  @IsString()
  @IsNotEmpty()
  company_name?: string;

  @ValidateIf((o) => o.landlord_type === LandlordType.CORPORATE)
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OnboardingDocumentDto)
  corporate_documents?: OnboardingDocumentDto[];

  // ---- Scope of services ----
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  scope_services: string[];

  @ValidateIf((o) => (o.scope_services ?? []).includes('Other'))
  @IsString()
  @IsNotEmpty()
  scope_other?: string;

  // Full wizard state stored verbatim as the prefill blob (frontend-owned shape).
  @IsOptional()
  @IsObject()
  data?: Record<string, any>;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OnboardingPropertyDto)
  properties: OnboardingPropertyDto[];
}
