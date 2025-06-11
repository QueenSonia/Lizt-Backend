// twilio.service.ts
import { Injectable } from '@nestjs/common';
import { Twilio } from 'twilio';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class TwilioService {
  private client: Twilio;
  private whatsappNumber: string;

  constructor(private configService: ConfigService) {
    this.client = new Twilio(
      configService.get('TWILIO_ACCOUNT_SID'),
      configService.get('TWILIO_AUTH_TOKEN'),
    );
    const whatsappNumber = configService.get('TWILIO_WHATSAPP_NUMBER');
    if (!whatsappNumber) {
      throw new Error('TWILIO_WHATSAPP_NUMBER is not defined in the environment');
    }
    this.whatsappNumber = whatsappNumber;

  }

  async sendWhatsAppMessage(to: string, body: string) {
    console.log(to, body)
    return await this.client.messages.create({
      from: this.whatsappNumber,
      to: `whatsapp:${to}`,
      body,
    });
  }

  async sendWhatsAppMediaMessage(to: string, mediaUrl: string, caption?: string) {
    return await this.client.messages.create({
      from: this.whatsappNumber,
      to: `whatsapp:${to}`,
      body: caption || '',
      mediaUrl: [mediaUrl],
    });
  }
}
