"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WhatsappBotModule = void 0;
const common_1 = require("@nestjs/common");
const whatsapp_bot_service_1 = require("./whatsapp-bot.service");
const whatsapp_bot_controller_1 = require("./whatsapp-bot.controller");
const typeorm_1 = require("@nestjs/typeorm");
const service_request_entity_1 = require("../service-requests/entities/service-request.entity");
let WhatsappBotModule = class WhatsappBotModule {
};
exports.WhatsappBotModule = WhatsappBotModule;
exports.WhatsappBotModule = WhatsappBotModule = __decorate([
    (0, common_1.Module)({
        imports: [typeorm_1.TypeOrmModule.forFeature([service_request_entity_1.ServiceRequest])],
        controllers: [whatsapp_bot_controller_1.WhatsappBotController],
        providers: [whatsapp_bot_service_1.WhatsappBotService],
    })
], WhatsappBotModule);
//# sourceMappingURL=whatsapp-bot.module.js.map