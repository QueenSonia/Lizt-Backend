import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  IsBoolean,
  IsDateString,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OtherFeeDto } from '../../offer-letters/dto/create-offer-letter.dto';

export class InitiateRenewalDto {
  @ApiProperty({
    description: 'Rent amount for the renewal period',
    example: 500000,
  })
  @IsNotEmpty()
  @IsNumber()
  rentAmount: number;

  @ApiProperty({
    description: 'Payment frequency (Monthly, Quarterly, Bi-annually, Annually)',
    example: 'Annually',
  })
  @IsNotEmpty()
  @IsString()
  paymentFrequency: string;

  @ApiProperty({
    description: 'Service charge for the renewal period',
    example: 50000,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  serviceCharge?: number;

  @ApiProperty({
    description: 'If true, creates/updates the invoice without sending a WhatsApp notification to the tenant',
    example: false,
    required: false,
  })
  @IsOptional()
  @IsBoolean()
  silent?: boolean;

  @ApiProperty({
    description: 'Custom end date for the renewal period (ISO date string, e.g. 2026-12-31). If omitted, end date is auto-calculated from start date + frequency.',
    example: '2026-12-31',
    required: false,
  })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description:
      'Override the renewal start date. If omitted, server uses activeRent.expiry_date + 1 day.',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({
    description:
      'IDs of impact issues the landlord has already acknowledged. Blockers with IDs not in this list cause the mutation to 409.',
    type: [String],
    example: ['sent_public_token:7d4e...'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  acknowledgedIssueIds?: string[];

  // Billing v2 — per-fee overrides. If omitted, defaults come from the
  // active rent row so "Renew" pre-fills correctly.
  @ApiPropertyOptional({ example: 100000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  cautionDeposit?: number;

  @ApiPropertyOptional({ example: 25000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  legalFee?: number;

  @ApiPropertyOptional({ example: 50000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  agencyFee?: number;

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
}
