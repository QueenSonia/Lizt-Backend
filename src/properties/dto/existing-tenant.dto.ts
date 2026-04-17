import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsString,
  IsNumber,
  IsEmail,
  IsOptional,
  IsDateString,
  Min,
  ValidateNested,
} from 'class-validator';

export class OtherFeeDto {
  @ApiProperty({ example: 'Diesel levy', description: 'Name of the fee' })
  @IsNotEmpty()
  @IsString()
  name: string;

  @ApiProperty({ example: 25000, description: 'Amount of the fee' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  amount: number;

  @ApiProperty({
    example: false,
    description: 'Whether this fee recurs every billing cycle',
  })
  @IsBoolean()
  recurring: boolean;

  @ApiProperty({ required: false, description: 'Optional stable id' })
  @IsOptional()
  @IsString()
  externalId?: string;
}

export class ExistingTenantDto {
  @ApiProperty({
    example: 'John',
    description: 'First name of the existing tenant',
  })
  @IsNotEmpty()
  @IsString()
  firstName: string;

  @ApiProperty({
    example: 'Doe',
    description: 'Surname of the existing tenant',
  })
  @IsNotEmpty()
  @IsString()
  surname: string;

  @ApiProperty({
    example: '+2348012345678',
    description: 'WhatsApp phone number of the tenant',
  })
  @IsNotEmpty()
  @IsString()
  phone: string;

  @ApiProperty({
    example: 'john.doe@example.com',
    description: 'Email address of the tenant',
    required: false,
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({
    example: 500000,
    description: 'Monthly rent amount',
    type: 'number',
  })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  rentAmount: number;

  @ApiProperty({
    example: 'monthly',
    description: 'Frequency of rent payment (monthly, quarterly, annually)',
  })
  @IsNotEmpty()
  @IsString()
  rentFrequency: string;

  @ApiProperty({
    example: '2024-01-01',
    description: 'Start date of the tenancy',
  })
  @IsNotEmpty()
  @IsDateString()
  tenancyStartDate: string;

  @ApiProperty({
    example: '2024-01-31',
    description: 'Due date for rent payment',
  })
  @IsNotEmpty()
  @IsDateString()
  rentDueDate: string;

  @ApiProperty({
    example: 50000,
    description: 'Service charge amount',
    type: 'number',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  serviceChargeAmount?: number;

  @ApiProperty({ required: false, description: 'Whether service charge recurs' })
  @IsOptional()
  @IsBoolean()
  serviceChargeRecurring?: boolean;

  @ApiProperty({
    example: 100000,
    description: 'Caution / security deposit (optional)',
    type: 'number',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  cautionDeposit?: number;

  @ApiProperty({ required: false, description: 'Whether caution deposit recurs' })
  @IsOptional()
  @IsBoolean()
  cautionDepositRecurring?: boolean;

  @ApiProperty({
    example: 25000,
    description: 'Legal fee (optional)',
    type: 'number',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  legalFee?: number;

  @ApiProperty({ required: false, description: 'Whether legal fee recurs' })
  @IsOptional()
  @IsBoolean()
  legalFeeRecurring?: boolean;

  @ApiProperty({
    example: 50000,
    description: 'Agency fee (optional)',
    type: 'number',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  agencyFee?: number;

  @ApiProperty({ required: false, description: 'Whether agency fee recurs' })
  @IsOptional()
  @IsBoolean()
  agencyFeeRecurring?: boolean;

  @ApiProperty({
    description: 'Arbitrary one-time fees charged at tenancy start',
    type: [OtherFeeDto],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OtherFeeDto)
  otherFees?: OtherFeeDto[];
}
