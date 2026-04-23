import {
  IsNotEmpty,
  IsNumber,
  IsDateString,
  IsUUID,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OtherFeeDto } from '../../offer-letters/dto/create-offer-letter.dto';

export enum RentFrequency {
  MONTHLY = 'Monthly',
  QUARTERLY = 'Quarterly',
  BI_ANNUALLY = 'Bi-Annually',
  ANNUALLY = 'Annually',
  CUSTOM = 'Custom',
}

export class AttachTenantFromKycDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'KYC Application ID',
  })
  @IsNotEmpty()
  @IsUUID()
  kycApplicationId: string;

  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Property ID to attach tenant to',
  })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({
    example: 500000,
    description: 'Monthly rent amount in naira',
    type: 'integer',
  })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  rentAmount: number;

  @ApiProperty({
    example: RentFrequency.MONTHLY,
    description: 'Frequency of rent payment',
    enum: RentFrequency,
  })
  @IsNotEmpty()
  @IsEnum(RentFrequency)
  rentFrequency: RentFrequency;

  @ApiProperty({
    example: '2024-01-01',
    description: 'Tenancy start date',
  })
  @IsNotEmpty()
  @IsDateString()
  tenancyStartDate: string;

  @ApiPropertyOptional({
    example: '2024-01-31',
    description:
      'Rent due date. Optional — if omitted, derived server-side from tenancyEndDate + frequency.',
  })
  @IsOptional()
  @IsDateString()
  rentDueDate?: string;

  @ApiPropertyOptional({
    example: '2025-01-01',
    description:
      'Tenancy end date. Preferred input; rentDueDate is derived from it.',
  })
  @IsOptional()
  @IsDateString()
  tenancyEndDate?: string;

  @ApiProperty({
    example: 50000,
    description: 'Service charge amount (optional)',
    type: 'integer',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  serviceCharge?: number;

  @ApiProperty({
    example: 100000,
    description: 'Caution / security deposit (optional)',
    type: 'integer',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  cautionDeposit?: number;

  @ApiProperty({
    example: 25000,
    description: 'Legal fee (optional)',
    type: 'integer',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  legalFee?: number;

  @ApiProperty({
    example: 50000,
    description: 'Agency fee (optional)',
    type: 'integer',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  agencyFee?: number;

  // Billing v2 — per-fee recurring flags.
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  serviceChargeRecurring?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  securityDepositRecurring?: boolean;

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
}
