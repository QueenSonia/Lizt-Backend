import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';

export class WhatsappUtils {
  private static globalEventEmitter: EventEmitter2;

  constructor(private readonly config: ConfigService) {}

  static setEventEmitter(eventEmitter: EventEmitter2) {
    WhatsappUtils.globalEventEmitter = eventEmitter;
  }

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
    // Check simulation mode directly from environment
    const simulatorMode = process.env.WHATSAPP_SIMULATOR;
    const isSimulationMode = simulatorMode === 'true';

    if (isSimulationMode) {
      console.log(
        '🎭 WhatsappUtils: Simulation mode detected, intercepting message',
      );
      console.log(
        '📤 WhatsappUtils payload:',
        JSON.stringify(payload, null, 2),
      );

      // In simulation mode, we need to convert phone numbers back to emails
      // for proper frontend routing
      const modifiedPayload = { ...payload };
      const to = (payload as any).to;

      // If the 'to' field looks like a phone number, try to find the original email
      if (to && to.startsWith('+') && to.length > 10) {
        console.log(
          '🔄 Converting phone number back to email for simulator routing',
        );
        // For now, we'll use a simple mapping - in a real app, you'd want a proper lookup
        if (to === '+2349138834648') {
          (modifiedPayload as any).to = 'tunjioginni@gmail.com';
          console.log(
            '📧 Converted phone to email for simulator:',
            to,
            '→',
            'tunjioginni@gmail.com',
          );
        }
      }

      // Emit to simulator if EventEmitter is available
      if (WhatsappUtils.globalEventEmitter) {
        console.log('📡 WhatsappUtils: Emitting to simulator');
        WhatsappUtils.globalEventEmitter.emit(
          'whatsapp.outbound',
          modifiedPayload,
        );
      } else {
        console.log(
          '⚠️ WhatsappUtils: EventEmitter not available, cannot emit to simulator',
        );
      }

      // Return simulated response
      return {
        messaging_product: 'whatsapp',
        contacts: [{ input: (payload as any).to, wa_id: (payload as any).to }],
        messages: [{ id: `sim_msg_${Date.now()}`, message_status: 'accepted' }],
      };
    }

    // Production mode - send to real WhatsApp API
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
      return data;
    } catch (error) {
      console.error('Error sending to WhatsApp API:', error);
      throw error;
    }
  }
}
