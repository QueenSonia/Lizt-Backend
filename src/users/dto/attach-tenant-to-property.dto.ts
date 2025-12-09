import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsOptional,
  IsDateString,
  IsUUID,
  Min,
} from 'class-validator';

export enum RentFrequency {
  MONTHLY = 'Monthly',
  QUARTERLY = 'Quarterly',
  BI_ANNUALLY = 'Bi-Annually',
  ANNUALLY = 'Annually',
}

export class AttachTenantToPropertyDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'Property ID to attach tenant to',
  })
  @IsNotEmpty()
  @IsUUID()
  propertyId: string;

  @ApiProperty({
    example: '2024-01-01',
    description: 'Tenancy start date',
  })
  @IsNotEmpty()
  @IsDateString()
  tenancyStartDate: string;

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
