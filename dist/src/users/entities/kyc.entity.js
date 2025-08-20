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
exports.KYC = void 0;
const openapi = require("@nestjs/swagger");
const base_entity_1 = require("../../base.entity");
const typeorm_1 = require("typeorm");
const account_entity_1 = require("./account.entity");
let KYC = class KYC extends base_entity_1.BaseEntity {
    former_house_address;
    reason_for_leaving;
    former_accomodation_type;
    occupation;
    employers_name;
    employers_address;
    state_of_origin;
    lga_of_origin;
    home_town;
    nationality;
    religion;
    marital_status;
    name_of_spouse;
    next_of_kin;
    next_of_kin_address;
    guarantor;
    guarantor_address;
    guarantor_occupation;
    guarantor_phone_number;
    monthly_income;
    accept_terms_and_condition;
    user;
    static _OPENAPI_METADATA_FACTORY() {
        return { former_house_address: { required: true, type: () => String }, reason_for_leaving: { required: true, type: () => String }, former_accomodation_type: { required: true, type: () => String }, occupation: { required: true, type: () => String }, employers_name: { required: true, type: () => String }, employers_address: { required: true, type: () => String }, state_of_origin: { required: true, type: () => String }, lga_of_origin: { required: true, type: () => String }, home_town: { required: true, type: () => String }, nationality: { required: true, type: () => String }, religion: { required: true, type: () => String }, marital_status: { required: true, type: () => String }, name_of_spouse: { required: true, type: () => String }, next_of_kin: { required: true, type: () => String }, next_of_kin_address: { required: true, type: () => String }, guarantor: { required: true, type: () => String }, guarantor_address: { required: true, type: () => String }, guarantor_occupation: { required: true, type: () => String }, guarantor_phone_number: { required: true, type: () => String }, monthly_income: { required: true, type: () => String }, accept_terms_and_condition: { required: true, type: () => Boolean }, user: { required: true, type: () => require("./account.entity").Account } };
    }
};
exports.KYC = KYC;
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "former_house_address", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "reason_for_leaving", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "former_accomodation_type", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "occupation", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "employers_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "employers_address", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "state_of_origin", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "lga_of_origin", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "home_town", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "nationality", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "religion", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "marital_status", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "name_of_spouse", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "next_of_kin", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "next_of_kin_address", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "guarantor", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "guarantor_address", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "guarantor_occupation", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "guarantor_phone_number", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], KYC.prototype, "monthly_income", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar', default: false }),
    __metadata("design:type", Boolean)
], KYC.prototype, "accept_terms_and_condition", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => account_entity_1.Account, (user) => user.kyc, { onDelete: 'CASCADE' }),
    (0, typeorm_1.JoinColumn)({ name: 'user_id', referencedColumnName: 'id' }),
    __metadata("design:type", account_entity_1.Account)
], KYC.prototype, "user", void 0);
exports.KYC = KYC = __decorate([
    (0, typeorm_1.Entity)()
], KYC);
//# sourceMappingURL=kyc.entity.js.map