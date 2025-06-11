// whatsapp.service.ts
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AfricaTalkingService {
  private readonly apiUrl = 'https://chat.africastalking.com/whatsapp/message/send';
  private readonly apiKey: string;
  private readonly username: string;

  constructor(private configService: ConfigService) {
    this.apiKey = configService.get<string>('AFRICAS_TALKING_API_KEY')!;
    this.username = configService.get<string>('AFRICAS_TALKING_USERNAME')!;

    if (!this.apiKey || !this.username) {
      throw new Error('Missing Africa’s Talking API credentials in environment');
    }
  }

  async sendWhatsAppMessage(to: string, message: string): Promise<any> {
    try {
      const payload = {
        username: this.username,
        waNumber: to,
        phoneNumber: to,
        body: {
          message,
        },
      };

      const response = await axios.post(this.apiUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          apiKey: this.apiKey,
        },
      });

      return response.data;
    } catch (error) {
      console.error('Error sending WhatsApp message via Africa’s Talking:', error?.response?.data || error.message);
      throw error;
    }
  }
}
