import {
  IsUUID,
  IsNumber,
  IsString,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsBoolean,
  ValidateNested,
  Min,
  MaxLength,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Rent frequency options for offer letters
 */
export enum RentFrequency {
  MONTHLY = 'Monthly',
  QUARTERLY = 'Quarterly',
  BI_ANNUALLY = 'Bi-Annually',
  ANNUALLY = 'Annually',
  CUSTOM = 'Custom',
}

/**
 * Terms of Tenancy DTO
 * Represents a single term/condition in the offer letter
 */
export class TermsOfTenancyDto {
  @ApiProperty({ example: 'Permitted Use', description: 'Title of the term' })
  @IsString()
  @MaxLength(255)
  title: string;

  @ApiProperty({
    example: 'The property shall be used for residential purposes only.',
    description: 'Content of the term',
  })
  @IsString()
  content: string;
}

/**
 * Content Snapshot DTO
 */
export class ContentSnapshotDto {
  @ApiProperty({ example: 'OFFER FOR RENT' })
  @IsString()
  offer_title: string;

  @ApiProperty({ example: 'We are pleased to offer...' })
  @IsString()
  intro_text: string;

  @ApiProperty({ example: 'This agreement is between...' })
  @IsString()
  agreement_text: string;

  @ApiProperty({ example: 'Yours faithfully,' })
  @IsString()
  closing_text: string;

  @ApiProperty({ example: 'For Landlord' })
  @IsString()
  for_landlord_text: string;

  @ApiProperty({ example: '123 Main St' })
  @IsString()
  tenant_address: string;

  @ApiProperty({ example: 'Residential' })
  @IsString()
  permitted_use: string;

  @ApiPropertyOptional({ example: 'NGN 1,000,000' })
  @IsOptional()
  @IsString()
  rent_amount_formatted?: string;

  @ApiPropertyOptional({ example: 'NGN 100,000' })
  @IsOptional()
  @IsString()
  service_charge_formatted?: string;

  @ApiPropertyOptional({ example: 'NGN 50,000' })
  @IsOptional()
  @IsString()
  caution_deposit_formatted?: string;

  @ApiPropertyOptional({ example: 'NGN 20,000' })
  @IsOptional()
  @IsString()
  legal_fee_formatted?: string;

  @ApiPropertyOptional({ example: 'NGN 30,000' })
  @IsOptional()
  @IsString()
  agency_fee_formatted?: string;

  @ApiPropertyOptional({ example: '1 year' })
  @IsOptional()
  @IsString()
  tenancy_term?: string;

  @ApiPropertyOptional({ example: '2024-2025' })
  @IsOptional()
  @IsString()
  tenancy_period?: string;
}

/**
 * Billing v2 — one entry of the dynamic `otherFees` list.
 */
export class OtherFeeDto {
  @ApiPropertyOptional({ example: 'of_abc123' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  externalId?: string;

  @ApiProperty({ example: 'Diesel' })
  @IsString()
  @MaxLength(64)
  name: string;

  @ApiProperty({ example: 25000 })
  @IsNumber()
  @Min(0)
  amount: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  recurring: boolean;
}

/**
 * Create Offer Letter DTO
 * Used for creating a new offer letter from the landlord dashboard
 * Requirements: 5.2, 10.1
 */
export class CreateOfferLetterDto {
  @ApiProperty({ example: '00000000-0000-0000-0000-000000000000' })
  @IsUUID()
  kycApplicationId: string;

  @ApiProperty({ example: '00000000-0000-0000-0000-000000000000' })
  @IsUUID()
  propertyId: string;

  @ApiProperty({ example: 1000000 })
  @IsNumber()
  @Min(0)
  rentAmount: number;

  @ApiProperty({ enum: RentFrequency, example: RentFrequency.ANNUALLY })
  @IsEnum(RentFrequency)
  rentFrequency: RentFrequency;

  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  serviceCharge?: number;

  @ApiProperty({ example: '2024-01-01' })
  @IsDateString()
  tenancyStartDate: string;

  @ApiProperty({ example: '2024-12-31' })
  @IsDateString()
  tenancyEndDate: string;

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cautionDeposit?: number;

  @ApiPropertyOptional({ example: 20000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  legalFee?: number;

  @ApiPropertyOptional({ example: 30000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  agencyFee?: number;

  // Billing v2 — per-fee recurring flags.
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  serviceChargeRecurring?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  cautionDepositRecurring?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  legalFeeRecurring?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  agencyFeeRecurring?: boolean;

  @ApiPropertyOptional({ type: () => [OtherFeeDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OtherFeeDto)
  otherFees?: OtherFeeDto[];

  @ApiProperty({ type: () => [TermsOfTenancyDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TermsOfTenancyDto)
  termsOfTenancy: TermsOfTenancyDto[];

  @ApiPropertyOptional({ type: () => ContentSnapshotDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContentSnapshotDto)
  contentSnapshot?: ContentSnapshotDto;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  sendNotification?: boolean; // If true, send WhatsApp notification immediately
}
