import { IsNumberString, IsString } from 'class-validator';

export class CreateWhatsAppBotMessage {
  @IsNumberString()
  recipient_number: string;

  @IsString()
  message: string;
}
