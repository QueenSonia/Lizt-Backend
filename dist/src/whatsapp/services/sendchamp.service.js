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
exports.SendchampService = void 0;
const common_1 = require("@nestjs/common");
const axios_1 = __importDefault(require("axios"));
const config_1 = require("@nestjs/config");
let SendchampService = class SendchampService {
    configService;
    apiUrl = 'https://sandbox-api.sendchamp.com/api/v1/whatsapp/template/send';
    secretKey;
    constructor(configService) {
        this.configService = configService;
        this.secretKey = this.configService.get('SENDCHAMP_SECRET_KEY');
        if (!this.secretKey) {
            throw new Error('Missing Sendchamp secret key in environment');
        }
    }
    async sendTemplateMessage(recipient, templateCode, sender, customData) {
        try {
            const payload = {
                recipient,
                type: 'template',
                template_code: templateCode,
                sender,
                custom_data: {
                    body: customData,
                },
            };
            const response = await axios_1.default.post(this.apiUrl, payload, {
                headers: {
                    Accept: 'application/json',
                    Authorization: `Bearer ${this.secretKey}`,
                },
            });
            return response.data;
        }
        catch (error) {
            console.error('Error sending WhatsApp message via Sendchamp:', error?.response?.data || error.message);
            throw error;
        }
    }
};
exports.SendchampService = SendchampService;
exports.SendchampService = SendchampService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], SendchampService);
//# sourceMappingURL=sendchamp.service.js.map