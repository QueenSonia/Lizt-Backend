import { ConfigService } from '@nestjs/config';
export declare class AfricaTalkingService {
    private configService;
    private readonly apiUrl;
    private readonly apiKey;
    private readonly username;
    constructor(configService: ConfigService);
    sendWhatsAppMessage(to: string, message: string): Promise<any>;
}
