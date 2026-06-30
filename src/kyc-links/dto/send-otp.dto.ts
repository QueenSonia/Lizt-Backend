import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsValidPhoneNumber } from '../../common/validation/is-valid-phone.decorator';

export class SendOTPDto {
  @ApiProperty({
    example: '+2348123456789',
    description:
      'Phone number to send the OTP to. Nigerian numbers may be local (0803...) or international; non-Nigerian numbers must include the country code (e.g. +44...).',
  })
  @IsString()
  @IsNotEmpty({ message: 'Phone number is required' })
  @IsValidPhoneNumber({
    message: 'Please provide a valid phone number',
  })
  phoneNumber: string;
}
