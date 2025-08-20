import { ConfigService } from '@nestjs/config';
export declare class SendchampService {
    private configService;
    private readonly apiUrl;
    private readonly secretKey;
    constructor(configService: ConfigService);
    sendTemplateMessage(recipient: string, templateCode: string, sender: string, customData: Record<string, any>): Promise<any>;
}
