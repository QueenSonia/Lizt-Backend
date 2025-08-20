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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AfricaTalkingService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
const config_1 = require("@nestjs/config");
let AfricaTalkingService = class AfricaTalkingService {
    configService;
    apiUrl = 'https://chat.africastalking.com/whatsapp/message/send';
    apiKey;
    username;
    constructor(configService) {
        this.configService = configService;
        this.apiKey = configService.get('AFRICAS_TALKING_API_KEY');
        this.username = configService.get('AFRICAS_TALKING_USERNAME');
        if (!this.apiKey || !this.username) {
            throw new Error('Missing Africa’s Talking API credentials in environment');
        }
    }
    async sendWhatsAppMessage(to, message) {
        try {
            const payload = {
                username: this.username,
                waNumber: to,
                phoneNumber: to,
                body: {
                    message,
                },
            };
            const response = await axios_1.default.post(this.apiUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    apiKey: this.apiKey,
                },
            });
            return response.data;
        }
        catch (error) {
            console.error('Error sending WhatsApp message via Africa’s Talking:', error?.response?.data || error.message);
            throw error;
        }
    }
};
exports.AfricaTalkingService = AfricaTalkingService;
exports.AfricaTalkingService = AfricaTalkingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AfricaTalkingService);
//# sourceMappingURL=africastalking.service.js.map