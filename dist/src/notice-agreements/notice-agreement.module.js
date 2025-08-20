"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoticeAgreementModule = void 0;
const common_1 = require("@nestjs/common");
const notice_agreement_controller_1 = require("./notice-agreement.controller");
const notice_agreement_service_1 = require("./notice-agreement.service");
const typeorm_1 = require("@nestjs/typeorm");
const notice_agreement_entity_1 = require("./entities/notice-agreement.entity");
const property_entity_1 = require("../properties/entities/property.entity");
const user_entity_1 = require("../users/entities/user.entity");
const cloudinary_1 = require("../utils/cloudinary");
const whatsapp_module_1 = require("../whatsapp/whatsapp.module");
const account_entity_1 = require("../users/entities/account.entity");
let NoticeAgreementModule = class NoticeAgreementModule {
};
exports.NoticeAgreementModule = NoticeAgreementModule;
exports.NoticeAgreementModule = NoticeAgreementModule = __decorate([
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([notice_agreement_entity_1.NoticeAgreement, property_entity_1.Property, user_entity_1.Users, account_entity_1.Account]),
            whatsapp_module_1.WhatsappModule,
        ],
        controllers: [notice_agreement_controller_1.NoticeAgreementController],
        providers: [notice_agreement_service_1.NoticeAgreementService, cloudinary_1.FileUploadService],
    })
], NoticeAgreementModule);
//# sourceMappingURL=notice-agreement.module.js.map