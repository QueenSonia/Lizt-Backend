import { IsEmail, IsOptional, IsString, IsNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class InitializePaymentDto {
  @ApiProperty({
    description: 'Email address for payment receipt',
    example: 'tenant@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @ApiProperty({
    description: 'Payment option selected by tenant',
    example: 'full',
    required: false,
    enum: ['full', 'custom'],
  })
  @IsOptional()
  @IsString()
  paymentOption?: string;

  @ApiProperty({
    description:
      'The selected payment amount (must be >= total invoice amount for custom payments)',
    example: 550000,
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  amount?: number;
}
