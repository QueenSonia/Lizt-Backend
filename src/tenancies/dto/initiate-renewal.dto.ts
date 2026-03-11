import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString, IsOptional } from 'class-validator';

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
}
