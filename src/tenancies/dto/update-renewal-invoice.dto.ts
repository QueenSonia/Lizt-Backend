import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsNumber,
  IsString,
  IsOptional,
  Min,
  IsDateString,
  IsBoolean,
  IsArray,
  ArrayMaxSize,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { OtherFeeDto } from '../../offer-letters/dto/create-offer-letter.dto';

export class UpdateRenewalInvoiceDto {
  @ApiProperty({ description: 'Rent amount for the renewal period', example: 300000 })
  @IsNotEmpty()
  @IsNumber()
  @Min(1)
  rentAmount: number;

  @ApiProperty({ description: 'Payment frequency', example: 'Annually' })
  @IsNotEmpty()
  @IsString()
  paymentFrequency: string;

  @ApiProperty({ description: 'Service charge', example: 0, required: false })
  @IsOptional()
  @IsNumber()
  @Min(0)
  serviceCharge?: number;

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
      'Override the tenancy start date (active-rent edit only — ignored for renewal-invoice edits where start_date is fixed to the invoice record). ISO date string.',
    example: '2026-01-01',
  })
  @IsOptional()
  @IsDateString()
  rentStartDate?: string;

  @ApiPropertyOptional({
    description:
      'IDs of impact issues the landlord has already acknowledged. Blockers with IDs not in this list cause the mutation to 409.',
    type: [String],
    example: ['stale_renewal_invoice:7d4e...'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  acknowledgedIssueIds?: string[];

  // Billing v2 — per-fee overrides.
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
