"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const config_1 = require("@nestjs/config");
const dotenv_flow_1 = require("dotenv-flow");
const event_emitter_1 = require("@nestjs/event-emitter");
const ormconfig_1 = __importDefault(require("../ormconfig"));
const app_controller_1 = require("./app.controller");
const app_service_1 = require("./app.service");
const auth_module_1 = require("./auth/auth.module");
const users_module_1 = require("./users/users.module");
const properties_module_1 = require("./properties/properties.module");
const rents_module_1 = require("./rents/rents.module");
const service_requests_module_1 = require("./service-requests/service-requests.module");
const property_history_module_1 = require("./property-history/property-history.module");
const notice_agreement_module_1 = require("./notice-agreements/notice-agreement.module");
const whatsapp_module_1 = require("./whatsapp/whatsapp.module");
const notification_module_1 = require("./notifications/notification.module");
const chat_module_1 = require("./chat/chat.module");
const database_service_1 = require("./database.service");
const tenant_kyc_module_1 = require("./tenant-kyc/tenant-kyc.module");
const whatsapp_bot_module_1 = require("./whatsapp-bot/whatsapp-bot.module");
const cache_1 = require("./lib/cache");
(0, dotenv_flow_1.config)({ default_node_env: 'production' });
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            config_1.ConfigModule.forRoot({
                isGlobal: true,
                load: [ormconfig_1.default],
                cache: true,
            }),
            typeorm_1.TypeOrmModule.forRootAsync({
                inject: [config_1.ConfigService],
                useFactory: async (configService) => {
                    const typeOrmConfig = configService.get('typeorm');
                    if (!typeOrmConfig)
                        throw new Error('TypeORM configuration not found');
                    return typeOrmConfig;
                },
            }),
            cache_1.AppCacheModule,
            auth_module_1.AuthModule,
            users_module_1.UsersModule,
            properties_module_1.PropertiesModule,
            rents_module_1.RentsModule,
            service_requests_module_1.ServiceRequestsModule,
            property_history_module_1.PropertyHistoryModule,
            notice_agreement_module_1.NoticeAgreementModule,
            whatsapp_module_1.WhatsappModule,
            notification_module_1.NotificationModule,
            chat_module_1.ChatModule,
            event_emitter_1.EventEmitterModule.forRoot(),
            tenant_kyc_module_1.TenantKycModule,
            whatsapp_bot_module_1.WhatsappBotModule,
        ],
        controllers: [app_controller_1.AppController],
        providers: [app_service_1.AppService, database_service_1.DatabaseService],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map