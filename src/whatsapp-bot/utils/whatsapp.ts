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
    console.log('📤 [WhatsappUtils.sendLandlordMainMenu] START', {
      to,
      landlordName,
      timestamp: new Date().toISOString(),
    });

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

    console.log(
      '📤 [WhatsappUtils.sendLandlordMainMenu] Payload:',
      JSON.stringify(payload, null, 2),
    );

    const result = await this.sendToWhatsappAPI(payload);

    console.log(
      '✅ [WhatsappUtils.sendLandlordMainMenu] Result:',
      JSON.stringify(result, null, 2),
    );

    return result;
  }

  private async sendToWhatsappAPI(payload: object) {
    console.log('🌐 [WhatsappUtils.sendToWhatsappAPI] START');
    console.log(
      '🌐 [WhatsappUtils.sendToWhatsappAPI] Payload recipient:',
      (payload as any).to,
    );

    // Check simulation mode directly from environment
    const simulatorMode = process.env.WHATSAPP_SIMULATOR;
    const isSimulationMode = simulatorMode === 'true';

    console.log('🌐 [WhatsappUtils.sendToWhatsappAPI] Mode check:', {
      WHATSAPP_SIMULATOR: simulatorMode,
      isSimulationMode,
    });

    if (isSimulationMode) {
      console.log(
        '🎭 WhatsappUtils: Simulation mode detected, intercepting message',
      );
      console.log(
        '📤 WhatsappUtils payload:',
        JSON.stringify(payload, null, 2),
      );

      // Emit to simulator if EventEmitter is available
      // The frontend handles phone number matching directly - no conversion needed
      if (WhatsappUtils.globalEventEmitter) {
        console.log('📡 WhatsappUtils: Emitting to simulator');
        WhatsappUtils.globalEventEmitter.emit('whatsapp.outbound', payload);
      } else {
        console.log(
          '⚠️ WhatsappUtils: EventEmitter not available, cannot emit to simulator',
        );
      }

      // Return simulated response
      const simResponse = {
        messaging_product: 'whatsapp',
        contacts: [{ input: (payload as any).to, wa_id: (payload as any).to }],
        messages: [{ id: `sim_msg_${Date.now()}`, message_status: 'accepted' }],
      };
      console.log(
        '🎭 [WhatsappUtils.sendToWhatsappAPI] Simulated response:',
        simResponse,
      );
      return simResponse;
    }

    // Production mode - send to real WhatsApp API
    console.log(
      '🚀 [WhatsappUtils.sendToWhatsappAPI] Production mode - sending to WhatsApp API',
    );
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
      console.log(
        '✅ [WhatsappUtils.sendToWhatsappAPI] Response from WhatsApp API:',
        data,
      );
      return data;
    } catch (error) {
      console.error(
        '❌ [WhatsappUtils.sendToWhatsappAPI] Error sending to WhatsApp API:',
        error,
      );
      throw error;
    }
  }
}
