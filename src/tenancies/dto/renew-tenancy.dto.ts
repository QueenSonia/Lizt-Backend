import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsString } from 'class-validator';

export class RenewTenancyDto {
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
