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
exports.Users = void 0;
const openapi = require("@nestjs/swagger");
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../base.entity");
const property_entity_1 = require("../../properties/entities/property.entity");
const property_tenants_entity_1 = require("../../properties/entities/property-tenants.entity");
const rent_entity_1 = require("../../rents/entities/rent.entity");
const service_request_entity_1 = require("../../service-requests/entities/service-request.entity");
const property_history_entity_1 = require("../../property-history/entities/property-history.entity");
const notice_agreement_entity_1 = require("../../notice-agreements/entities/notice-agreement.entity");
const kyc_entity_1 = require("./kyc.entity");
const account_entity_1 = require("./account.entity");
const tenant_kyc_entity_1 = require("../../tenant-kyc/entities/tenant-kyc.entity");
const tenant_kyc_entity_2 = require("../../tenant-kyc/entities/tenant-kyc.entity");
let Users = class Users extends base_entity_1.BaseEntity {
    first_name;
    last_name;
    email;
    phone_number;
    password;
    role;
    is_verified;
    logo_urls;
    creator_id;
    date_of_birth;
    gender;
    state_of_origin;
    lga;
    nationality;
    employment_status;
    employer_name;
    job_title;
    employer_address;
    monthly_income;
    work_email;
    business_name;
    nature_of_business;
    business_address;
    business_monthly_income;
    business_website;
    marital_status;
    spouse_full_name;
    spouse_phone_number;
    spouse_occupation;
    spouse_employer;
    source_of_funds;
    monthly_income_estimate;
    accounts;
    properties;
    rents;
    service_requests;
    property_tenants;
    property_histories;
    notice_agreements;
    kyc;
    tenant_kyc;
    static _OPENAPI_METADATA_FACTORY() {
        return { first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, email: { required: true, type: () => String }, phone_number: { required: true, type: () => String }, password: { required: true, type: () => String }, role: { required: true, type: () => String }, is_verified: { required: true, type: () => Boolean }, logo_urls: { required: false, type: () => [String], nullable: true }, creator_id: { required: false, type: () => String, nullable: true }, date_of_birth: { required: false, type: () => Date }, gender: { required: false, type: () => Object }, state_of_origin: { required: false, type: () => String }, lga: { required: false, type: () => String }, nationality: { required: false, type: () => String }, employment_status: { required: false, type: () => Object }, employer_name: { required: false, type: () => String }, job_title: { required: false, type: () => String }, employer_address: { required: false, type: () => String }, monthly_income: { required: false, type: () => Number }, work_email: { required: false, type: () => String }, business_name: { required: false, type: () => String }, nature_of_business: { required: false, type: () => String }, business_address: { required: false, type: () => String }, business_monthly_income: { required: false, type: () => Number }, business_website: { required: false, type: () => String }, marital_status: { required: false, type: () => Object }, spouse_full_name: { required: false, type: () => String }, spouse_phone_number: { required: false, type: () => String }, spouse_occupation: { required: false, type: () => String }, spouse_employer: { required: false, type: () => String }, source_of_funds: { required: false, type: () => String }, monthly_income_estimate: { required: false, type: () => Number }, accounts: { required: true, type: () => [require("./account.entity").Account] }, properties: { required: true, type: () => [require("../../properties/entities/property.entity").Property] }, rents: { required: true, type: () => [require("../../rents/entities/rent.entity").Rent] }, service_requests: { required: true, type: () => [require("../../service-requests/entities/service-request.entity").ServiceRequest] }, property_tenants: { required: true, type: () => [require("../../properties/entities/property-tenants.entity").PropertyTenant] }, property_histories: { required: true, type: () => [require("../../property-history/entities/property-history.entity").PropertyHistory] }, notice_agreements: { required: true, type: () => [require("../../notice-agreements/entities/notice-agreement.entity").NoticeAgreement] }, kyc: { required: true, type: () => require("./kyc.entity").KYC }, tenant_kyc: { required: false, type: () => require("./user.entity").Users } };
    }
};
exports.Users = Users;
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "first_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "last_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "email", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "phone_number", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "password", void 0);
__decorate([
    (0, typeorm_1.Column)({
        nullable: false,
        type: 'enum',
        enum: base_entity_1.RolesEnum,
        default: base_entity_1.RolesEnum.TENANT,
    }),
    __metadata("design:type", String)
], Users.prototype, "role", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'boolean', default: false }),
    __metadata("design:type", Boolean)
], Users.prototype, "is_verified", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar', array: true }),
    __metadata("design:type", Object)
], Users.prototype, "logo_urls", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'uuid' }),
    __metadata("design:type", Object)
], Users.prototype, "creator_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'date' }),
    __metadata("design:type", Date)
], Users.prototype, "date_of_birth", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'enum', enum: tenant_kyc_entity_2.Gender }),
    __metadata("design:type", String)
], Users.prototype, "gender", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "state_of_origin", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "lga", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "nationality", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'enum', enum: tenant_kyc_entity_2.EmploymentStatus }),
    __metadata("design:type", String)
], Users.prototype, "employment_status", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "employer_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "job_title", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "employer_address", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'float' }),
    __metadata("design:type", Number)
], Users.prototype, "monthly_income", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "work_email", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "business_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "nature_of_business", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "business_address", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'float' }),
    __metadata("design:type", Number)
], Users.prototype, "business_monthly_income", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "business_website", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'enum', enum: tenant_kyc_entity_2.MaritalStatus }),
    __metadata("design:type", String)
], Users.prototype, "marital_status", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "spouse_full_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "spouse_phone_number", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "spouse_occupation", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "spouse_employer", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Users.prototype, "source_of_funds", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'float' }),
    __metadata("design:type", Number)
], Users.prototype, "monthly_income_estimate", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => account_entity_1.Account, (account) => account.user),
    __metadata("design:type", Array)
], Users.prototype, "accounts", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => property_entity_1.Property, (p) => p.owner),
    __metadata("design:type", Array)
], Users.prototype, "properties", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => rent_entity_1.Rent, (r) => r.tenant),
    __metadata("design:type", Array)
], Users.prototype, "rents", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => service_request_entity_1.ServiceRequest, (sr) => sr.tenant),
    __metadata("design:type", Array)
], Users.prototype, "service_requests", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => property_tenants_entity_1.PropertyTenant, (pt) => pt.tenant),
    __metadata("design:type", Array)
], Users.prototype, "property_tenants", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => property_history_entity_1.PropertyHistory, (ph) => ph.tenant),
    __metadata("design:type", Array)
], Users.prototype, "property_histories", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => notice_agreement_entity_1.NoticeAgreement, (na) => na.tenant),
    __metadata("design:type", Array)
], Users.prototype, "notice_agreements", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => kyc_entity_1.KYC, (kyc) => kyc.user),
    __metadata("design:type", kyc_entity_1.KYC)
], Users.prototype, "kyc", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => tenant_kyc_entity_1.TenantKyc, (tenant_kyc) => tenant_kyc.user),
    __metadata("design:type", Users)
], Users.prototype, "tenant_kyc", void 0);
exports.Users = Users = __decorate([
    (0, typeorm_1.Unique)(['email']),
    (0, typeorm_1.Unique)(['phone_number']),
    (0, typeorm_1.Entity)({ name: 'users' })
], Users);
//# sourceMappingURL=user.entity.js.map