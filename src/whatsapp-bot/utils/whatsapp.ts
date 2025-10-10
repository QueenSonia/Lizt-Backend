import { ConfigService } from "@nestjs/config";

export class WhatsappUtils {
    constructor(private readonly config: ConfigService) {}

    /**
     * Send a plain text message to WhatsApp with preserved formatting.
     * This ensures line breaks (\n) and indentation are displayed correctly in WhatsApp.
     */
    async sendText(to: string, text: string) {
        // Preserve line breaks and indentation
        const formattedText = text
            .trim()
            .replace(/\r\n/g, '\n') // Normalize newlines
            .replace(/\n{2,}/g, '\n\n') // Keep intentional double line spacing
            .replace(/\s{2,}/g, '  '); // Maintain spacing for alignment

        const payload = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to,
            type: 'text',
            text: {
                preview_url: false,
                body: formattedText,
            },
        };

        await this.sendToWhatsappAPI(payload);
    }

    /**
     * Send an interactive message with buttons.
     */
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
     * Internal method for sending payloads to the WhatsApp Cloud API.
     */
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
