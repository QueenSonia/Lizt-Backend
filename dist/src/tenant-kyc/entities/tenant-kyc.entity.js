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
exports.TenantKyc = exports.EmploymentStatus = exports.MaritalStatus = exports.Gender = void 0;
const openapi = require("@nestjs/swagger");
const typeorm_1 = require("typeorm");
const user_entity_1 = require("../../users/entities/user.entity");
const base_entity_1 = require("../../base.entity");
var Gender;
(function (Gender) {
    Gender["MALE"] = "male";
    Gender["FEMALE"] = "female";
    Gender["OTHER"] = "other";
})(Gender || (exports.Gender = Gender = {}));
var MaritalStatus;
(function (MaritalStatus) {
    MaritalStatus["SINGLE"] = "single";
    MaritalStatus["MARRIED"] = "married";
    MaritalStatus["DIVORCED"] = "divorced";
    MaritalStatus["WIDOWED"] = "widowed";
})(MaritalStatus || (exports.MaritalStatus = MaritalStatus = {}));
var EmploymentStatus;
(function (EmploymentStatus) {
    EmploymentStatus["EMPLOYED"] = "employed";
    EmploymentStatus["SELF_EMPLOYED"] = "self-employed";
    EmploymentStatus["UNEMPLOYED"] = "unemployed";
    EmploymentStatus["STUDENT"] = "student";
})(EmploymentStatus || (exports.EmploymentStatus = EmploymentStatus = {}));
let TenantKyc = class TenantKyc extends base_entity_1.BaseEntity {
    first_name;
    last_name;
    email;
    phone_number;
    date_of_birth;
    gender;
    nationality;
    current_residence;
    state_of_origin;
    local_government_area;
    marital_status;
    religion;
    spouse_name_and_contact;
    employment_status;
    occupation;
    job_title;
    employer_name;
    employer_address;
    employer_phone_number;
    monthly_net_income;
    reference1_name;
    reference1_address;
    reference1_relationship;
    reference1_phone_number;
    reference2_name;
    reference2_address;
    reference2_relationship;
    reference2_phone_number;
    user_id;
    user;
    admin_id;
    admin;
    identity_hash;
    toJSON() {
        const kyc = this;
        delete kyc.admin_id;
        delete kyc.user_id;
        delete kyc.identity_hash;
        delete kyc.updated_at;
        return kyc;
    }
    static _OPENAPI_METADATA_FACTORY() {
        return { first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, email: { required: true, type: () => String }, phone_number: { required: true, type: () => String }, date_of_birth: { required: true, type: () => Date }, gender: { required: true, type: () => Object }, nationality: { required: true, type: () => String }, current_residence: { required: true, type: () => String }, state_of_origin: { required: true, type: () => String }, local_government_area: { required: true, type: () => String }, marital_status: { required: true, type: () => Object }, religion: { required: true, type: () => String }, spouse_name_and_contact: { required: true, type: () => String }, employment_status: { required: true, type: () => Object }, occupation: { required: true, type: () => String }, job_title: { required: true, type: () => String }, employer_name: { required: true, type: () => String }, employer_address: { required: true, type: () => String }, employer_phone_number: { required: true, type: () => String }, monthly_net_income: { required: true, type: () => String }, reference1_name: { required: true, type: () => String }, reference1_address: { required: true, type: () => String }, reference1_relationship: { required: true, type: () => String }, reference1_phone_number: { required: true, type: () => String }, reference2_name: { required: true, type: () => String }, reference2_address: { required: true, type: () => String }, reference2_relationship: { required: true, type: () => String }, reference2_phone_number: { required: true, type: () => String }, user_id: { required: false, type: () => String }, user: { required: false, type: () => require("../../users/entities/user.entity").Users }, admin_id: { required: true, type: () => String }, admin: { required: false, type: () => require("../../users/entities/user.entity").Users }, identity_hash: { required: true, type: () => String } };
    }
};
exports.TenantKyc = TenantKyc;
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "first_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "last_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], TenantKyc.prototype, "email", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], TenantKyc.prototype, "phone_number", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'date' }),
    __metadata("design:type", Date)
], TenantKyc.prototype, "date_of_birth", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: Gender }),
    __metadata("design:type", String)
], TenantKyc.prototype, "gender", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "nationality", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], TenantKyc.prototype, "current_residence", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "state_of_origin", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "local_government_area", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: MaritalStatus }),
    __metadata("design:type", String)
], TenantKyc.prototype, "marital_status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], TenantKyc.prototype, "religion", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], TenantKyc.prototype, "spouse_name_and_contact", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: EmploymentStatus }),
    __metadata("design:type", String)
], TenantKyc.prototype, "employment_status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "occupation", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "job_title", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], TenantKyc.prototype, "employer_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], TenantKyc.prototype, "employer_address", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], TenantKyc.prototype, "employer_phone_number", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "monthly_net_income", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "reference1_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "reference1_address", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "reference1_relationship", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "reference1_phone_number", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], TenantKyc.prototype, "reference2_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], TenantKyc.prototype, "reference2_address", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], TenantKyc.prototype, "reference2_relationship", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", String)
], TenantKyc.prototype, "reference2_phone_number", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'uuid' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "user_id", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => user_entity_1.Users, (user) => user.tenant_kyc, { cascade: ['remove'] }),
    __metadata("design:type", user_entity_1.Users)
], TenantKyc.prototype, "user", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid' }),
    __metadata("design:type", String)
], TenantKyc.prototype, "admin_id", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => user_entity_1.Users, (user) => user.tenant_kyc),
    __metadata("design:type", user_entity_1.Users)
], TenantKyc.prototype, "admin", void 0);
__decorate([
    (0, typeorm_1.Column)({ unique: true, type: 'varchar', length: 64 }),
    __metadata("design:type", String)
], TenantKyc.prototype, "identity_hash", void 0);
exports.TenantKyc = TenantKyc = __decorate([
    (0, typeorm_1.Entity)('tenant_kyc')
], TenantKyc);
//# sourceMappingURL=tenant-kyc.entity.js.map