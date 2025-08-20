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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsAppController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const twilio_service_1 = require("./services/twilio.service");
const create_twilio_dto_1 = require("./dto/create-twilio.dto");
const swagger_1 = require("@nestjs/swagger");
const africastalking_service_1 = require("./services/africastalking.service");
let WhatsAppController = class WhatsAppController {
    twilioService;
    africaTalkingService;
    constructor(twilioService, africaTalkingService) {
        this.twilioService = twilioService;
        this.africaTalkingService = africaTalkingService;
    }
    async TwilioSendWhatsAppMedia(payload) {
        try {
            const { to, mediaUrl, body } = payload;
            const result = await this.twilioService.sendWhatsAppMediaMessage(to, mediaUrl, body);
            return { message: 'WhatsApp message sent successfully', data: result };
        }
        catch (error) {
            throw new common_1.BadRequestException(error.message || 'Failed to send WhatsApp message');
        }
    }
    async AfricaTalkingSendWhatsAppMedia(payload) {
        try {
            const { to, message } = payload;
            const result = await this.africaTalkingService.sendWhatsAppMessage(to, message);
            return { message: 'WhatsApp message sent successfully', data: result };
        }
        catch (error) {
            throw new common_1.BadRequestException(error.message || 'Failed to send WhatsApp message');
        }
    }
};
exports.WhatsAppController = WhatsAppController;
__decorate([
    (0, swagger_1.ApiOperation)({ summary: 'Send WhatsApp Message with Media' }),
    (0, swagger_1.ApiBody)({ type: create_twilio_dto_1.CreateTwilioDto }),
    (0, swagger_1.ApiCreatedResponse)({ description: 'Message sent successfully' }),
    (0, swagger_1.ApiBadRequestResponse)({ description: 'Failed to send message' }),
    (0, swagger_1.ApiSecurity)('access_token'),
    (0, common_1.Post)('send-whatsapp'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [create_twilio_dto_1.CreateTwilioDto]),
    __metadata("design:returntype", Promise)
], WhatsAppController.prototype, "TwilioSendWhatsAppMedia", null);
__decorate([
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WhatsAppController.prototype, "AfricaTalkingSendWhatsAppMedia", null);
exports.WhatsAppController = WhatsAppController = __decorate([
    (0, swagger_1.ApiTags)('Twilio'),
    (0, common_1.Controller)('twilio'),
    __metadata("design:paramtypes", [twilio_service_1.TwilioService,
        africastalking_service_1.AfricaTalkingService])
], WhatsAppController);
//# sourceMappingURL=whatsapp.controller.js.map