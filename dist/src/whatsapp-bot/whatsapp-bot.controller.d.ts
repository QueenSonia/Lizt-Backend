import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { WhatsappBotService } from './whatsapp-bot.service';
import { WhatsAppWebhookPayload } from './utils';
export declare class WhatsappBotController {
    private readonly whatsappBotService;
    private readonly config;
    constructor(whatsappBotService: WhatsappBotService, config: ConfigService);
    verify(mode: string, token: string, challenge: string): string;
    create(payload: WhatsAppWebhookPayload): Promise<void>;
    handleRequest(req: Request, res: Response): Promise<Response<any, Record<string, any>> | undefined>;
    sendBulkMessageToCustomer(req: Request): Promise<void>;
    sendToUserWithTemplate(req: Request): Promise<void>;
}
