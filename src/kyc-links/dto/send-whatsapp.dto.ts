import { IsString, IsNotEmpty, IsPhoneNumber } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendWhatsAppDto {
  @ApiProperty({
    example: '+2348123456789',
    description: 'Phone number to send the KYC link to (international format)',
  })
  @IsString()
  @IsNotEmpty({ message: 'Enter a valid phone number to send via WhatsApp' })
  @IsPhoneNumber('NG', {
    message: 'Please provide a valid Nigerian phone number',
  })
  phoneNumber: string;
}
