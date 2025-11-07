import { IsString, IsNotEmpty, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOTPDto {
  @ApiProperty({
    example: '123456',
    description: 'The 6-digit OTP code received via SMS',
  })
  @IsString()
  @IsNotEmpty({ message: 'OTP code is required' })
  @Length(6, 6, { message: 'OTP must be exactly 6 digits' })
  otpCode: string;

  @ApiProperty({
    example: '+2348123456789',
    description: 'Phone number that received the OTP',
  })
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  phoneNumber: string;
}
