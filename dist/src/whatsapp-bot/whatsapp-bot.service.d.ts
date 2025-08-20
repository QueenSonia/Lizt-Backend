import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { Users } from 'src/users/entities/user.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { CacheService } from 'src/lib/cache';
import { UsersService } from 'src/users/users.service';
import { IncomingMessage } from './utils';
export declare class WhatsappBotService {
    private usersRepo;
    private readonly serviceRequestRepo;
    private readonly cache;
    private readonly config;
    private readonly userService;
    private wa;
    constructor(usersRepo: Repository<Users>, serviceRequestRepo: Repository<ServiceRequest>, cache: CacheService, config: ConfigService, userService: UsersService);
    getNextScreen(decryptedBody: any): Promise<any>;
    handleMessage(messages: IncomingMessage[]): Promise<void>;
    sendWhatsappMessageWithTemplate({ phone_number, template_name, template_language, template_parameters, }: {
        phone_number: string;
        template_name: string;
        template_language?: string;
        template_parameters?: Array<{
            type: 'text';
            text: string;
            parameter_name?: string;
        }>;
    }): Promise<void>;
    private delay;
    sendToUserWithTemplate(phone_number: string, customer_name: string): Promise<void>;
    sendToAgentWithTemplate(phone_number: any): Promise<void>;
    sendBulkMessageToCustomer(customer_phone_list: string[], text: string): Promise<void>;
    sendText(to: string, text: string): Promise<void>;
    sendButtons(to: string, text: string | undefined, buttons: {
        id: string;
        title: string;
    }[]): Promise<void>;
    sendCTAButton(to: string): Promise<void>;
    sendWelcomeMenu(to: string, name?: string): Promise<void>;
    sendFlow(recipientNumber: string): Promise<void>;
    private sendToWhatsappAPI;
}
