import {
  IsUUID,
  IsNumber,
  IsString,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  ValidateNested,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Rent frequency options for offer letters
 */
export enum RentFrequency {
  MONTHLY = 'Monthly',
  QUARTERLY = 'Quarterly',
  BI_ANNUALLY = 'Bi-Annually',
  ANNUALLY = 'Annually',
}

/**
 * Terms of Tenancy DTO
 * Represents a single term/condition in the offer letter
 */
export class TermsOfTenancyDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsString()
  content: string;
}


/**
 * Content Snapshot DTO
 */
export class ContentSnapshotDto {
  @IsString()
  offer_title: string;

  @IsString()
  intro_text: string;

  @IsString()
  agreement_text: string;

  @IsString()
  closing_text: string;

  @IsString()
  for_landlord_text: string;

  @IsString()
  tenant_address: string;

  @IsString()
  permitted_use: string;

  @IsOptional()
  @IsString()
  rent_amount_formatted?: string;

  @IsOptional()
  @IsString()
  service_charge_formatted?: string;

  @IsOptional()
  @IsString()
  caution_deposit_formatted?: string;

  @IsOptional()
  @IsString()
  legal_fee_formatted?: string;

  @IsOptional()
  @IsString()
  agency_fee_formatted?: string;

  @IsOptional()
  @IsString()
  tenancy_term?: string;

  @IsOptional()
  @IsString()
  tenancy_period?: string;
}

/**
 * Create Offer Letter DTO
 * Used for creating a new offer letter from the landlord dashboard
 * Requirements: 5.2, 10.1
 */
export class CreateOfferLetterDto {
  @IsUUID()
  kycApplicationId: string;

  @IsUUID()
  propertyId: string;

  @IsNumber()
  @Min(0)
  rentAmount: number;

  @IsEnum(RentFrequency)
  rentFrequency: RentFrequency;

  @IsOptional()
  @IsNumber()
  @Min(0)
  serviceCharge?: number;

  @IsDateString()
  tenancyStartDate: string;

  @IsDateString()
  tenancyEndDate: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  cautionDeposit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  legalFee?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  agencyFee?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TermsOfTenancyDto)
  termsOfTenancy: TermsOfTenancyDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ContentSnapshotDto)
  contentSnapshot?: ContentSnapshotDto;
}
