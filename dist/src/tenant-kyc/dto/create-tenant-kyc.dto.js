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
exports.CreateTenantKycDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const tenant_kyc_entity_1 = require("../entities/tenant-kyc.entity");
class CreateTenantKycDto {
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
    admin_id;
    static _OPENAPI_METADATA_FACTORY() {
        return { first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, email: { required: false, type: () => String, description: "Email will be required when phone number is not provided", example: "sewkito@gmail.com", format: "email" }, phone_number: { required: false, type: () => String, description: "Phone number will be required when email is not provided", example: "+2348148696119" }, date_of_birth: { required: true, type: () => String, example: "1996-04-22T11:03:13.157Z" }, gender: { required: true, type: () => Object, description: "Can either be: \"male\", \"female\", or \"other\".", example: "male", enum: Object.values(tenant_kyc_entity_1.Gender) }, nationality: { required: true, type: () => String }, current_residence: { required: false, type: () => String }, state_of_origin: { required: true, type: () => String }, local_government_area: { required: true, type: () => String }, marital_status: { required: true, type: () => Object, description: "Can either be: \"single\", \"married\", \"divorced\", or \"widowed\".", example: "single", enum: Object.values(tenant_kyc_entity_1.MaritalStatus) }, religion: { required: false, type: () => String }, spouse_name_and_contact: { required: false, type: () => String }, employment_status: { required: true, type: () => Object, description: "Can either be: \"employed\", \"self-employed\", \"unemployed\", or \"student\".", example: "employed", enum: Object.values(tenant_kyc_entity_1.EmploymentStatus) }, occupation: { required: true, type: () => String }, job_title: { required: false, type: () => String, description: "Only required when `employment_status` is `employed`" }, employer_name: { required: false, type: () => String, description: "Only required when `employment_status` is `employed`" }, employer_address: { required: false, type: () => String, description: "Only required when `employment_status` is `employed`" }, employer_phone_number: { required: false, type: () => String, description: "Only required when `employment_status` is `employed`" }, monthly_net_income: { required: true, type: () => String }, reference1_name: { required: true, type: () => String }, reference1_address: { required: true, type: () => String }, reference1_relationship: { required: true, type: () => String }, reference1_phone_number: { required: true, type: () => String }, reference2_name: { required: false, type: () => String }, reference2_address: { required: false, type: () => String }, reference2_relationship: { required: false, type: () => String }, reference2_phone_number: { required: false, type: () => String }, admin_id: { required: true, type: () => String, format: "uuid" } };
    }
}
exports.CreateTenantKycDto = CreateTenantKycDto;
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "first_name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "last_name", void 0);
__decorate([
    (0, class_validator_1.ValidateIf)((o) => !o.phone_number?.trim()),
    (0, class_validator_1.IsEmail)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.ValidateIf)((o) => !o.email?.trim()),
    (0, class_validator_1.IsPhoneNumber)('NG'),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "phone_number", void 0);
__decorate([
    (0, class_validator_1.IsDateString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "date_of_birth", void 0);
__decorate([
    (0, class_validator_1.IsIn)(Object.values(tenant_kyc_entity_1.Gender)),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "gender", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "nationality", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "current_residence", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "state_of_origin", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "local_government_area", void 0);
__decorate([
    (0, class_validator_1.IsIn)(Object.values(tenant_kyc_entity_1.MaritalStatus)),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "marital_status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "religion", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "spouse_name_and_contact", void 0);
__decorate([
    (0, class_validator_1.IsIn)(Object.values(tenant_kyc_entity_1.EmploymentStatus)),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "employment_status", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "occupation", void 0);
__decorate([
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === 'employed'),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "job_title", void 0);
__decorate([
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === 'employed'),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "employer_name", void 0);
__decorate([
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === 'employed'),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "employer_address", void 0);
__decorate([
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === 'employed'),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsPhoneNumber)('NG'),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "employer_phone_number", void 0);
__decorate([
    (0, class_validator_1.IsNumberString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "monthly_net_income", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "reference1_name", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "reference1_address", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "reference1_relationship", void 0);
__decorate([
    (0, class_validator_1.IsPhoneNumber)('NG'),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "reference1_phone_number", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "reference2_name", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "reference2_address", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "reference2_relationship", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "reference2_phone_number", void 0);
__decorate([
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateTenantKycDto.prototype, "admin_id", void 0);
//# sourceMappingURL=create-tenant-kyc.dto.js.map