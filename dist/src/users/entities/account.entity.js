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
exports.Account = void 0;
const openapi = require("@nestjs/swagger");
const base_entity_1 = require("../../base.entity");
const typeorm_1 = require("typeorm");
const user_entity_1 = require("./user.entity");
const property_entity_1 = require("../../properties/entities/property.entity");
const rent_entity_1 = require("../../rents/entities/rent.entity");
const kyc_entity_1 = require("./kyc.entity");
const property_tenants_entity_1 = require("../../properties/entities/property-tenants.entity");
const property_history_entity_1 = require("../../property-history/entities/property-history.entity");
const service_request_entity_1 = require("../../service-requests/entities/service-request.entity");
const notice_agreement_entity_1 = require("../../notice-agreements/entities/notice-agreement.entity");
const notification_entity_1 = require("../../notifications/entities/notification.entity");
const team_member_entity_1 = require("./team-member.entity");
let Account = class Account extends base_entity_1.BaseEntity {
    email;
    password;
    is_verified;
    profile_name;
    role;
    creator_id;
    userId;
    user;
    properties;
    rents;
    property_tenants;
    property_histories;
    service_requests;
    notice_agreements;
    kyc;
    notification;
    teamMemberships;
    static _OPENAPI_METADATA_FACTORY() {
        return { email: { required: true, type: () => String }, password: { required: true, type: () => String }, is_verified: { required: true, type: () => Boolean }, profile_name: { required: true, type: () => String }, role: { required: true, enum: require("../../base.entity").RolesEnum }, creator_id: { required: true, type: () => String }, userId: { required: true, type: () => String }, user: { required: true, type: () => require("./user.entity").Users }, properties: { required: true, type: () => [require("../../properties/entities/property.entity").Property] }, rents: { required: true, type: () => require("../../rents/entities/rent.entity").Rent }, property_tenants: { required: true, type: () => [require("../../properties/entities/property-tenants.entity").PropertyTenant] }, property_histories: { required: true, type: () => [require("../../property-history/entities/property-history.entity").PropertyHistory] }, service_requests: { required: true, type: () => [require("../../service-requests/entities/service-request.entity").ServiceRequest] }, notice_agreements: { required: true, type: () => [require("../../notice-agreements/entities/notice-agreement.entity").NoticeAgreement] }, kyc: { required: true, type: () => require("./kyc.entity").KYC }, notification: { required: true, type: () => [require("../../notifications/entities/notification.entity").Notification] }, teamMemberships: { required: true, type: () => [require("./team-member.entity").TeamMember] } };
    }
};
exports.Account = Account;
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], Account.prototype, "email", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Account.prototype, "password", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], Account.prototype, "is_verified", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], Account.prototype, "profile_name", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: base_entity_1.RolesEnum,
    }),
    __metadata("design:type", String)
], Account.prototype, "role", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], Account.prototype, "creator_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], Account.prototype, "userId", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => user_entity_1.Users, (user) => user.accounts, { onDelete: 'CASCADE' }),
    __metadata("design:type", user_entity_1.Users)
], Account.prototype, "user", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => property_entity_1.Property, (p) => p.owner),
    __metadata("design:type", Array)
], Account.prototype, "properties", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => rent_entity_1.Rent, (r) => r.tenant),
    __metadata("design:type", rent_entity_1.Rent)
], Account.prototype, "rents", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => property_tenants_entity_1.PropertyTenant, (pt) => pt.tenant, {
        onDelete: 'CASCADE',
    }),
    __metadata("design:type", Array)
], Account.prototype, "property_tenants", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => property_history_entity_1.PropertyHistory, (ph) => ph.tenant),
    __metadata("design:type", Array)
], Account.prototype, "property_histories", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => service_request_entity_1.ServiceRequest, (sr) => sr.tenant),
    __metadata("design:type", Array)
], Account.prototype, "service_requests", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => notice_agreement_entity_1.NoticeAgreement, (na) => na.tenant),
    __metadata("design:type", Array)
], Account.prototype, "notice_agreements", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => kyc_entity_1.KYC, (kyc) => kyc.user),
    __metadata("design:type", kyc_entity_1.KYC)
], Account.prototype, "kyc", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => notification_entity_1.Notification, (notification) => notification.user),
    __metadata("design:type", Array)
], Account.prototype, "notification", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => team_member_entity_1.TeamMember, (teamMember) => teamMember.account),
    __metadata("design:type", Array)
], Account.prototype, "teamMemberships", void 0);
exports.Account = Account = __decorate([
    (0, typeorm_1.Entity)('accounts')
], Account);
//# sourceMappingURL=account.entity.js.map