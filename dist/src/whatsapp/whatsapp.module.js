"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappModule = void 0;
const common_1 = require("@nestjs/common");
const nestjs_twilio_1 = require("nestjs-twilio");
const config_1 = require("@nestjs/config");
const twilio_service_1 = require("./services/twilio.service");
const africastalking_service_1 = require("./services/africastalking.service");
let WhatsappModule = class WhatsappModule {
};
exports.WhatsappModule = WhatsappModule;
exports.WhatsappModule = WhatsappModule = __decorate([
    (0, common_1.Module)({
        imports: [
            nestjs_twilio_1.TwilioModule.forRootAsync({
                imports: [config_1.ConfigModule],
                useFactory: (configService) => ({
                    accountSid: configService.get('TWILIO_ACCOUNT_SID'),
                    authToken: configService.get('TWILIO_AUTH_TOKEN'),
                }),
                inject: [config_1.ConfigService],
            }),
        ],
        providers: [twilio_service_1.TwilioService, africastalking_service_1.AfricaTalkingService],
        exports: [twilio_service_1.TwilioService, africastalking_service_1.AfricaTalkingService],
    })
], WhatsappModule);
//# sourceMappingURL=whatsapp.module.js.map