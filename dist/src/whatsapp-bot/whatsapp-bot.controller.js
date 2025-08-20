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
exports.WhatsappBotController = void 0;
const openapi = require("@nestjs/swagger");
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const whatsapp_bot_service_1 = require("./whatsapp-bot.service");
const auth_decorator_1 = require("../auth/auth.decorator");
const utils_1 = require("./utils");
const validate_request_1 = require("./utils/validate-request");
let WhatsappBotController = class WhatsappBotController {
    whatsappBotService;
    config;
    constructor(whatsappBotService, config) {
        this.whatsappBotService = whatsappBotService;
        this.config = config;
    }
    verify(mode, token, challenge) {
        const verifyToken = this.config.get('WEBHOOK_VERIFICATION_TOKEN');
        console.log(`Webhook verification: mode=${mode}, token=${token}, challenge=${challenge}`);
        if (mode === 'subscribe' && token === verifyToken)
            return challenge;
        throw new common_1.ForbiddenException();
    }
    async create(payload) {
        try {
            const value = payload?.entry?.[0]?.changes?.[0]?.value;
            const messages = value?.messages;
            if (Array.isArray(messages)) {
                await this.whatsappBotService.handleMessage(messages);
            }
        }
        catch (error) {
            console.error('Webhook error:', error);
        }
    }
    async handleRequest(req, res) {
        console.log('hi');
        if (!process.env.PRIVATE_KEY) {
            throw new Error('Private key is empty. Please check your env variable "PRIVATE_KEY".');
        }
        const app_secret = this.config.get('M4D_APP_SECRET');
        if (!(0, validate_request_1.isRequestSignatureValid)(req, app_secret)) {
            return res.status(432).send();
        }
        let decryptedRequest = null;
        try {
            decryptedRequest = (0, utils_1.decryptRequest)(req.body, process.env.PRIVATE_KEY, process.env.PASSPHRASE);
        }
        catch (err) {
            console.error(err);
            if (err instanceof utils_1.FlowEndpointException) {
                return res.status(err.statusCode).send();
            }
            return res.status(500).send();
        }
        const { aesKeyBuffer, initialVectorBuffer, decryptedBody } = decryptedRequest;
        const screenResponse = await this.whatsappBotService.getNextScreen(decryptedBody);
        console.log('👉 Response to Encrypt:', screenResponse);
        res.send((0, utils_1.encryptResponse)(screenResponse, aesKeyBuffer, initialVectorBuffer));
    }
    async sendBulkMessageToCustomer(req) {
        try {
            const { customer_phone_list, message } = req.body;
            const response = await this.whatsappBotService.sendBulkMessageToCustomer(customer_phone_list, message);
            return response;
        }
        catch (error) {
            console.error('Error sending bulk message:', error);
            throw error;
        }
    }
    async sendToUserWithTemplate(req) {
        try {
            const { phone_number, customer_name } = req.body;
            const response = await this.whatsappBotService.sendToAgentWithTemplate(phone_number);
            return response;
        }
        catch (error) {
            console.error('Error sending user message:', error);
            throw error;
        }
    }
};
exports.WhatsappBotController = WhatsappBotController;
__decorate([
    (0, auth_decorator_1.SkipAuth)(),
    (0, common_1.Get)('webhook'),
    openapi.ApiResponse({ status: 200, type: String }),
    __param(0, (0, common_1.Query)('hub.mode')),
    __param(1, (0, common_1.Query)('hub.verify_token')),
    __param(2, (0, common_1.Query)('hub.challenge')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", void 0)
], WhatsappBotController.prototype, "verify", null);
__decorate([
    (0, auth_decorator_1.SkipAuth)(),
    (0, common_1.Post)('webhook'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WhatsappBotController.prototype, "create", null);
__decorate([
    (0, auth_decorator_1.SkipAuth)(),
    (0, common_1.HttpCode)(200),
    (0, common_1.Post)(''),
    openapi.ApiResponse({ status: 200 }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], WhatsappBotController.prototype, "handleRequest", null);
__decorate([
    (0, common_1.Post)('/bulk-message'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WhatsappBotController.prototype, "sendBulkMessageToCustomer", null);
__decorate([
    (0, common_1.Post)('/user-message'),
    openapi.ApiResponse({ status: 201 }),
    __param(0, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WhatsappBotController.prototype, "sendToUserWithTemplate", null);
exports.WhatsappBotController = WhatsappBotController = __decorate([
    (0, common_1.Controller)('whatsapp'),
    __metadata("design:paramtypes", [whatsapp_bot_service_1.WhatsappBotService,
        config_1.ConfigService])
], WhatsappBotController);
//# sourceMappingURL=whatsapp-bot.controller.js.map