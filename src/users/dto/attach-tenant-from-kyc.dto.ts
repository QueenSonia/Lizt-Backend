import {
  IsNotEmpty,
  IsNumber,
  IsDateString,
  IsUUID,
  IsOptional,
  IsEnum,
  IsString,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

import { ApiProperty } from '@nestjs/swagger';

export enum RentFrequency {
  MONTHLY = 'Monthly',
  QUARTERLY = 'Quarterly',
  BI_ANNUALLY = 'Bi-Annually',
  ANNUALLY = 'Annually',
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

  @ApiProperty({
    example: '2024-01-31',
    description: 'Rent due date',
  })
  @IsNotEmpty()
  @IsDateString()
  rentDueDate: string;

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
    example: 150000,
    description: 'Outstanding balance the tenant owes before onboarding (optional)',
    type: 'integer',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0, { message: 'Outstanding balance must be 0 or greater' })
  outstandingBalance?: number;

  @ApiProperty({
    example: 'Backlog rent for January–February',
    description: 'Reason for the outstanding balance (optional)',
    required: false,
  })
  @IsOptional()
  @IsString()
  outstandingBalanceReason?: string;
}
