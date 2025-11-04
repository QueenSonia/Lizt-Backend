import { IsString, IsNotEmpty, IsPhoneNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendOTPDto {
  @ApiProperty({
    example: '+2348123456789',
    description: 'Phone number to send the OTP to (international format)',
  })
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  @IsPhoneNumber('NG', {
    message: 'Please provide a valid Nigerian phone number',
  })
  phoneNumber: string;
}
