"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersModule = void 0;
const common_1 = require("@nestjs/common");
const users_service_1 = require("./users.service");
const users_controller_1 = require("./users.controller");
const typeorm_1 = require("@nestjs/typeorm");
const user_entity_1 = require("./entities/user.entity");
const auth_module_1 = require("../auth/auth.module");
const password_reset_token_entity_1 = require("./entities/password-reset-token.entity");
const property_tenants_entity_1 = require("../properties/entities/property-tenants.entity");
const cloudinary_1 = require("../utils/cloudinary");
const kyc_entity_1 = require("./entities/kyc.entity");
const account_entity_1 = require("./entities/account.entity");
const whatsapp_module_1 = require("../whatsapp/whatsapp.module");
const rent_entity_1 = require("../rents/entities/rent.entity");
const team_entity_1 = require("./entities/team.entity");
const team_member_entity_1 = require("./entities/team-member.entity");
let UsersModule = class UsersModule {
};
exports.UsersModule = UsersModule;
exports.UsersModule = UsersModule = __decorate([
    (0, common_1.Global)(),
    (0, common_1.Module)({
        imports: [
            typeorm_1.TypeOrmModule.forFeature([
                account_entity_1.Account,
                user_entity_1.Users,
                password_reset_token_entity_1.PasswordResetToken,
                property_tenants_entity_1.PropertyTenant,
                kyc_entity_1.KYC,
                rent_entity_1.Rent,
                team_entity_1.Team,
                team_member_entity_1.TeamMember
            ]),
            auth_module_1.AuthModule,
            whatsapp_module_1.WhatsappModule,
        ],
        controllers: [users_controller_1.UsersController],
        providers: [users_service_1.UsersService, cloudinary_1.FileUploadService],
        exports: [users_service_1.UsersService, typeorm_1.TypeOrmModule],
    })
], UsersModule);
//# sourceMappingURL=users.module.js.map