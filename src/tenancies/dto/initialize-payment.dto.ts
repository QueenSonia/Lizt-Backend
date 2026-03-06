import { IsEmail } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InitializePaymentDto {
  @ApiProperty({
    description: 'Email address for payment receipt',
    example: 'tenant@example.com',
  })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;
}
