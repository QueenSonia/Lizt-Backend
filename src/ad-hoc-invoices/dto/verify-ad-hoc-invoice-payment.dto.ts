import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyAdHocInvoicePaymentDto {
  @ApiProperty({
    description: 'Paystack transaction reference returned by the popup',
    example: 'INV_1705312200000_abcd1234',
  })
  @IsString()
  @IsNotEmpty()
  reference!: string;
}
