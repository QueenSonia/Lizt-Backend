import { ConfigService } from '@nestjs/config';
export declare class TwilioService {
    private configService;
    private client;
    private whatsappNumber;
    constructor(configService: ConfigService);
    sendWhatsAppMessage(to: string, body: string): Promise<import("twilio/lib/rest/api/v2010/account/message").MessageInstance>;
    sendWhatsAppMediaMessage(to: string, mediaUrl: string, caption?: string): Promise<import("twilio/lib/rest/api/v2010/account/message").MessageInstance>;
}
