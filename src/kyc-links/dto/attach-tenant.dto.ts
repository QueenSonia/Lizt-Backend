import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsOptional,
  IsDateString,
  Min,
  Max,
} from 'class-validator';

export enum RentFrequency {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  BI_ANNUALLY = 'bi-annually',
  ANNUALLY = 'annually',
}

export class AttachTenantDto {
  @ApiProperty({
    example: 500000,
    description: 'Monthly rent amount in naira',
    type: 'integer',
  })
  @IsNotEmpty()
  @IsNumber()
  @Type(() => Number)
  @Min(1, { message: 'Rent amount must be greater than 0' })
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
    description: 'Rent start date (optional, defaults to current date)',
    required: false,
  })
  @IsOptional()
  @IsDateString({ strict: false })
  tenancyStartDate?: string;

  @ApiProperty({
    example: 100000,
    description: 'Security deposit amount (optional)',
    type: 'integer',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0, { message: 'Security deposit must be 0 or greater' })
  securityDeposit?: number;

  @ApiProperty({
    example: 50000,
    description: 'Service charge amount (optional)',
    type: 'integer',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0, { message: 'Service charge must be 0 or greater' })
  serviceCharge?: number;
}
