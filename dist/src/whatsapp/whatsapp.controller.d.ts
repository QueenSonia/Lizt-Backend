import { TwilioService } from './services/twilio.service';
import { CreateTwilioDto } from './dto/create-twilio.dto';
import { AfricaTalkingService } from './services/africastalking.service';
export declare class WhatsAppController {
    private readonly twilioService;
    private readonly africaTalkingService;
    constructor(twilioService: TwilioService, africaTalkingService: AfricaTalkingService);
    TwilioSendWhatsAppMedia(payload: CreateTwilioDto): Promise<{
        message: string;
        data: import("twilio/lib/rest/api/v2010/account/message").MessageInstance;
    }>;
    AfricaTalkingSendWhatsAppMedia(payload: any): Promise<{
        message: string;
        data: any;
    }>;
}
