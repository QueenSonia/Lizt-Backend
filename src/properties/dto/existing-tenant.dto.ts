import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  IsNumber,
  IsEmail,
  IsOptional,
  IsDateString,
  Min,
} from 'class-validator';

export class ExistingTenantDto {
  @ApiProperty({
    example: 'John Doe',
    description: 'Full name of the existing tenant',
  })
  @IsNotEmpty()
  @IsString()
  fullName: string;

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
}
