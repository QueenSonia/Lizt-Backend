import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyPaymentDto {
  @ApiProperty({
    description: 'Paystack payment reference',
    example: 'RENEWAL_1234567890_abcd1234',
  })
  @IsString()
  @IsNotEmpty({ message: 'Payment reference is required' })
  reference: string;
}
