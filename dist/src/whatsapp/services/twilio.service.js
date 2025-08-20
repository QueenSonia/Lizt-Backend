"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TwilioService = void 0;
const common_1 = require("@nestjs/common");
const twilio_1 = require("twilio");
const config_1 = require("@nestjs/config");
let TwilioService = class TwilioService {
    configService;
    client;
    whatsappNumber;
    constructor(configService) {
        this.configService = configService;
        this.client = new twilio_1.Twilio(configService.get('TWILIO_ACCOUNT_SID'), configService.get('TWILIO_AUTH_TOKEN'));
        const whatsappNumber = configService.get('TWILIO_WHATSAPP_NUMBER');
        if (!whatsappNumber) {
            throw new Error('TWILIO_WHATSAPP_NUMBER is not defined in the environment');
        }
        this.whatsappNumber = whatsappNumber;
    }
    async sendWhatsAppMessage(to, body) {
        console.log(to, body);
        return await this.client.messages.create({
            from: this.whatsappNumber,
            to: `whatsapp:${to}`,
            body,
        });
    }
    async sendWhatsAppMediaMessage(to, mediaUrl, caption) {
        return await this.client.messages.create({
            from: this.whatsappNumber,
            to: `whatsapp:${to}`,
            body: caption || '',
            mediaUrl: [mediaUrl],
        });
    }
};
exports.TwilioService = TwilioService;
exports.TwilioService = TwilioService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], TwilioService);
//# sourceMappingURL=twilio.service.js.map