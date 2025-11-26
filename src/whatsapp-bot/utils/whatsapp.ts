import { ConfigService } from '@nestjs/config';

export class WhatsappUtils {
  constructor(private readonly config: ConfigService) {}
  async sendText(to: string, text: string) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: {
        preview_url: false,
        body: text,
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  async sendButtons(
    to: string,
    text: string = 'Hello, welcome to Property Kraft',
    buttons: { id: string; title: string }[],
  ) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
        action: {
          buttons: buttons.map((btn) => ({
            type: 'reply',
            reply: {
              id: btn.id,
              title: btn.title,
            },
          })),
        },
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  /**
   * Send landlord main menu with URL buttons (requires approved template)
   * Template name: landlord_main_menu
   * This uses a WhatsApp template with URL buttons that redirect directly
   */
  async sendLandlordMainMenu(to: string, landlordName: string) {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: 'landlord_main_menu',
        language: {
          code: 'en',
        },
        components: [
          {
            type: 'body',
            parameters: [
              {
                type: 'text',
                text: landlordName,
              },
            ],
          },
          {
            type: 'button',
            sub_type: 'quick_reply',
            index: 2, // Third button (Generate KYC Link)
            parameters: [
              {
                type: 'payload',
                payload: 'generate_kyc_link',
              },
            ],
          },
        ],
      },
    };

    await this.sendToWhatsappAPI(payload);
  }

  private async sendToWhatsappAPI(payload: object) {
    try {
      const response = await fetch(
        'https://graph.facebook.com/v23.0/746591371864338/messages',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.get('CLOUD_API_ACCESS_TOKEN')}`,
          },
          body: JSON.stringify(payload),
        },
      );

      const data = await response.json();
      console.log('Response from WhatsApp API:', data);
    } catch (error) {
      console.error('Error sending to WhatsApp API:', error);
    }
  }
}
