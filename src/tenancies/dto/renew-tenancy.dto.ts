import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsDateString } from 'class-validator';

export class RenewTenancyDto {
  @ApiProperty({
    description: 'New lease start date',
    example: '2024-01-01',
  })
  @IsNotEmpty()
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: 'New lease end date',
    example: '2025-01-01',
  })
  @IsNotEmpty()
  @IsDateString()
  endDate: string;

  @ApiProperty({
    description: 'New rent amount',
    example: 500000,
  })
  @IsNotEmpty()
  @IsNumber()
  rentAmount: number;

  @ApiProperty({
    description: 'Payment frequency',
    example: 'Monthly',
  })
  @IsNotEmpty()
  @IsString()
  paymentFrequency: string;
}
