import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsOptional, Min, IsDateString } from 'class-validator';

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
}
