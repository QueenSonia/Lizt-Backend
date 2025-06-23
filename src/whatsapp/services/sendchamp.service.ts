// sendchamp.service.ts
import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import e from 'express';

@Injectable()
export class SendchampService {
  private readonly apiUrl =
    'https://sandbox-api.sendchamp.com/api/v1/whatsapp/template/send';
  private readonly secretKey: string;

  constructor(private configService: ConfigService) {
    this.secretKey = this.configService.get<string>('SENDCHAMP_SECRET_KEY')!;
    if (!this.secretKey) {
      throw new Error('Missing Sendchamp secret key in environment');
    }
  }

  async sendTemplateMessage(
    recipient: string,
    templateCode: string,
    sender: string,
    customData: Record<string, any>,
  ): Promise<any> {
    try {
      const payload = {
        recipient,
        type: 'template',
        template_code: templateCode,
        sender,
        custom_data: {
          body: customData,
        },
      };

      const response = await axios.post(this.apiUrl, payload, {
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${this.secretKey}`,
        },
      });

      return response.data;
    } catch (error) {
      console.error(
        'Error sending WhatsApp message via Sendchamp:',
        error?.response?.data || error.message,
      );
      throw error;
    }
  }
}

// e.g
// await this.sendchampService.sendTemplateMessage(
//   '2348055372961',
//   'TEMPLATE_CODE',
//   '234810000000',
//   {
//     '1': 'Damilola',
//     '2': 'Olotu',
//     '3': 'Lagos',
//   },
// );