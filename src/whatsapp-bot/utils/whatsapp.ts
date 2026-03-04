import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatLogService } from '../chat-log.service';

export class WhatsappUtils {
  private static globalEventEmitter: EventEmitter2;

  constructor(
    private readonly config: ConfigService,
    private readonly chatLogService?: ChatLogService,
  ) {}

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

    const result = await this.sendToWhatsappAPI(payload);
    await this.logOutbound(to, 'text', text, payload, result);
    return result;
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

    const result = await this.sendToWhatsappAPI(payload);
    await this.logOutbound(to, 'interactive', text, payload, result);
    return result;
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

    const result = await this.sendToWhatsappAPI(payload);
    await this.logOutbound(
      to,
      'template',
      `Hello ${landlordName}, What do you want to do today?`,
      payload,
      result,
    );
    return result;
  }

  /**
   * Log outbound message to chat history if ChatLogService is available
   */
  private async logOutbound(
    phoneNumber: string,
    messageType: string,
    content: string,
    payload: object,
    apiResult: any,
  ): Promise<void> {
    if (!this.chatLogService) return;

    try {
      const wamid = apiResult?.messages?.[0]?.id;
      const isSimulated =
        process.env.WHATSAPP_SIMULATOR === 'true';

      await this.chatLogService.logOutboundMessage(
        phoneNumber,
        messageType,
        content,
        {
          ...payload,
          is_simulated: isSimulated,
          simulation_status: isSimulated
            ? 'simulator_message'
            : 'production_message',
          message_source: 'whatsapp_utils',
        },
        wamid,
      );
    } catch (error) {
      console.warn(
        '⚠️ WhatsappUtils: Failed to log outbound message (continuing):',
        (error as Error).message,
      );
    }
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
