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

  @IsNumber()
  @Min(0)
  cautionDeposit: number;

  @IsNumber()
  @Min(0)
  legalFee: number;

  @IsString()
  @MaxLength(255)
  agencyFee: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TermsOfTenancyDto)
  termsOfTenancy: TermsOfTenancyDto[];
}
