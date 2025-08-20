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
exports.CreateCustomerRepDto = exports.CreateAdminDto = exports.UploadLogoDto = exports.ResetDto = exports.LoginDto = exports.CreateUserDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const tenant_kyc_entity_1 = require("../../tenant-kyc/entities/tenant-kyc.entity");
class CreateUserDto {
    first_name;
    last_name;
    email;
    phone_number;
    role;
    lease_start_date;
    lease_end_date;
    property_id;
    rental_price;
    security_deposit;
    service_charge;
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
    static _OPENAPI_METADATA_FACTORY() {
        return { first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, email: { required: true, type: () => String, format: "email" }, phone_number: { required: true, type: () => String, minLength: 10 }, role: { required: false, type: () => String }, lease_start_date: { required: true, type: () => Date }, lease_end_date: { required: true, type: () => Date }, property_id: { required: true, type: () => String }, rental_price: { required: true, type: () => Number }, security_deposit: { required: true, type: () => Number }, service_charge: { required: true, type: () => Number }, date_of_birth: { required: true, type: () => String }, gender: { required: true, type: () => Object, enum: Object.values(tenant_kyc_entity_1.Gender) }, state_of_origin: { required: true, type: () => String }, lga: { required: true, type: () => String }, nationality: { required: true, type: () => String }, employment_status: { required: true, type: () => Object, enum: Object.values(tenant_kyc_entity_1.EmploymentStatus) }, employer_name: { required: false, type: () => String }, job_title: { required: false, type: () => String }, employer_address: { required: false, type: () => String }, monthly_income: { required: false, type: () => Number }, work_email: { required: false, type: () => String, format: "email" }, business_name: { required: false, type: () => String }, nature_of_business: { required: false, type: () => String }, business_address: { required: false, type: () => String }, business_monthly_income: { required: false, type: () => Number }, business_website: { required: false, type: () => String }, marital_status: { required: true, type: () => Object, enum: Object.values(tenant_kyc_entity_1.MaritalStatus) }, spouse_full_name: { required: false, type: () => String }, spouse_phone_number: { required: false, type: () => String }, spouse_occupation: { required: false, type: () => String }, spouse_employer: { required: false, type: () => String }, source_of_funds: { required: false, type: () => String }, monthly_income_estimate: { required: false, type: () => Number } };
    }
}
exports.CreateUserDto = CreateUserDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'John', description: 'First name of the user' }),
    (0, class_transformer_1.Transform)((val) => val.value.toLowerCase()),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "first_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Doe', description: 'Last name of the user' }),
    (0, class_transformer_1.Transform)((val) => val.value.toLowerCase()),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "last_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'user@example.com',
        description: 'Email of the user',
    }),
    (0, class_transformer_1.Transform)((val) => val.value.toLowerCase()),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsEmail)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '+2348104467932',
        description: 'Phone number of the user',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsPhoneNumber)(),
    (0, class_validator_1.MinLength)(10),
    __metadata("design:type", String)
], CreateUserDto.prototype, "phone_number", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'admin',
        description: 'Role of the user',
        required: false,
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)((val) => val.value.toLowerCase()),
    __metadata("design:type", String)
], CreateUserDto.prototype, "role", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '',
        description: 'lease start date',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", Date)
], CreateUserDto.prototype, "lease_start_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '',
        description: 'lease end date',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", Date)
], CreateUserDto.prototype, "lease_end_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the property',
        required: false,
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "property_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 500000,
        description: 'Rental price of the property',
        type: 'integer',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateUserDto.prototype, "rental_price", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 20000,
        description: 'Security payment',
        type: 'integer',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateUserDto.prototype, "security_deposit", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 50000,
        description: 'Service charge',
        type: 'integer',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateUserDto.prototype, "service_charge", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: '1990-01-01', description: 'Date of Birth' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "date_of_birth", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'male', description: 'Gender', enum: tenant_kyc_entity_1.Gender }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsIn)(Object.values(tenant_kyc_entity_1.Gender)),
    __metadata("design:type", String)
], CreateUserDto.prototype, "gender", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Lagos', description: 'State of Origin' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "state_of_origin", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Ikeja', description: 'Local Government Area' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "lga", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Nigerian', description: 'Nationality' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "nationality", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'employed',
        description: 'Employment Status',
        enum: tenant_kyc_entity_1.EmploymentStatus,
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsIn)(Object.values(tenant_kyc_entity_1.EmploymentStatus)),
    __metadata("design:type", String)
], CreateUserDto.prototype, "employment_status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Company Ltd',
        description: 'Employer Name',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === tenant_kyc_entity_1.EmploymentStatus.EMPLOYED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "employer_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Software Engineer',
        description: 'Job Title',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === tenant_kyc_entity_1.EmploymentStatus.EMPLOYED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "job_title", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '123 Main St',
        description: 'Employer Address',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === tenant_kyc_entity_1.EmploymentStatus.EMPLOYED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "employer_address", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 100000,
        description: 'Monthly Income (₦)',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === tenant_kyc_entity_1.EmploymentStatus.EMPLOYED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateUserDto.prototype, "monthly_income", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'work.email@company.com',
        description: 'Work Email (Optional)',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === tenant_kyc_entity_1.EmploymentStatus.EMPLOYED),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEmail)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "work_email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'My Business',
        description: 'Business Name',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === tenant_kyc_entity_1.EmploymentStatus.SELF_EMPLOYED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "business_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Trading',
        description: 'Nature of Business',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === tenant_kyc_entity_1.EmploymentStatus.SELF_EMPLOYED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "nature_of_business", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '123 Biz St',
        description: 'Business Address',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === tenant_kyc_entity_1.EmploymentStatus.SELF_EMPLOYED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "business_address", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 100000,
        description: 'Monthly Income (₦)',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === tenant_kyc_entity_1.EmploymentStatus.SELF_EMPLOYED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateUserDto.prototype, "business_monthly_income", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'www.business.com',
        description: 'Business Website (Optional)',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === tenant_kyc_entity_1.EmploymentStatus.SELF_EMPLOYED),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "business_website", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'single',
        description: 'Marital Status',
        enum: tenant_kyc_entity_1.MaritalStatus,
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsIn)(Object.values(tenant_kyc_entity_1.MaritalStatus)),
    __metadata("design:type", String)
], CreateUserDto.prototype, "marital_status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Jane Doe',
        description: 'Spouse Full Name',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.marital_status === tenant_kyc_entity_1.MaritalStatus.MARRIED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "spouse_full_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '+2348000000000',
        description: 'Spouse Phone Number',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.marital_status === tenant_kyc_entity_1.MaritalStatus.MARRIED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsPhoneNumber)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "spouse_phone_number", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Engineer',
        description: 'Spouse Occupation',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.marital_status === tenant_kyc_entity_1.MaritalStatus.MARRIED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "spouse_occupation", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Company Ltd',
        description: 'Spouse Employer (Optional)',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "spouse_employer", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'husband',
        description: 'Source of Funds (if unemployed)',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === tenant_kyc_entity_1.EmploymentStatus.UNEMPLOYED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateUserDto.prototype, "source_of_funds", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 400000,
        description: 'Monthly Income Estimate (₦) (if unemployed)',
        required: false,
    }),
    (0, class_validator_1.ValidateIf)((o) => o.employment_status === tenant_kyc_entity_1.EmploymentStatus.UNEMPLOYED),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateUserDto.prototype, "monthly_income_estimate", void 0);
class LoginDto {
    email;
    password;
    static _OPENAPI_METADATA_FACTORY() {
        return { email: { required: true, type: () => String, format: "email" }, password: { required: true, type: () => String, pattern: "/^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^\\w\\s]).{6,}$/" } };
    }
}
exports.LoginDto = LoginDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'app-ag-ib-1@apple.com',
        description: 'The email of the user',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsEmail)(undefined, { message: 'Invalid email address' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' && value?.toLowerCase()),
    __metadata("design:type", String)
], LoginDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Password5%',
        description: 'The password of the user',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{6,}$/, {
        message: 'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
    }),
    __metadata("design:type", String)
], LoginDto.prototype, "password", void 0);
class ResetDto {
    token;
    newPassword;
    static _OPENAPI_METADATA_FACTORY() {
        return { token: { required: true, type: () => String }, newPassword: { required: true, type: () => String, pattern: "/^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^\\w\\s]).{6,}$/" } };
    }
}
exports.ResetDto = ResetDto;
__decorate([
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ResetDto.prototype, "token", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Password5%',
        description: 'The password of the user',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{6,}$/, {
        message: 'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
    }),
    __metadata("design:type", String)
], ResetDto.prototype, "newPassword", void 0);
class UploadLogoDto {
    logos;
    static _OPENAPI_METADATA_FACTORY() {
        return { logos: { required: true, type: () => [Object] } };
    }
}
exports.UploadLogoDto = UploadLogoDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        type: 'array',
        items: {
            type: 'string',
            format: 'binary',
        },
        description: 'Admin logo image files (max 5)',
        required: true,
    }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Array)
], UploadLogoDto.prototype, "logos", void 0);
class CreateAdminDto {
    first_name;
    last_name;
    email;
    phone_number;
    role;
    property_id;
    password;
    static _OPENAPI_METADATA_FACTORY() {
        return { first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, email: { required: true, type: () => String, format: "email" }, phone_number: { required: true, type: () => String, minLength: 10 }, role: { required: false, type: () => String }, property_id: { required: true, type: () => String }, password: { required: true, type: () => String, pattern: "/^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{6,}$/" } };
    }
}
exports.CreateAdminDto = CreateAdminDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'John', description: 'First name of the user' }),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' && value.toLowerCase()),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateAdminDto.prototype, "first_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Doe', description: 'Last name of the user' }),
    (0, class_transformer_1.Transform)((val) => val.value.toLowerCase()),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateAdminDto.prototype, "last_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'user@example.com',
        description: 'Email of the user',
    }),
    (0, class_transformer_1.Transform)((val) => val.value.toLowerCase()),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsEmail)(),
    __metadata("design:type", String)
], CreateAdminDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '+2348104467932',
        description: 'Phone number of the user',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(10),
    __metadata("design:type", String)
], CreateAdminDto.prototype, "phone_number", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'admin',
        description: 'Role of the user',
        required: false,
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)((val) => val.value.toLowerCase()),
    __metadata("design:type", String)
], CreateAdminDto.prototype, "role", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the property',
        required: false,
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateAdminDto.prototype, "property_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Password5%',
        description: 'Password of the user (admin only)',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{6,}$/, {
        message: 'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
    }),
    __metadata("design:type", String)
], CreateAdminDto.prototype, "password", void 0);
class CreateCustomerRepDto {
    first_name;
    last_name;
    email;
    phone_number;
    password;
    role;
    property_id;
    static _OPENAPI_METADATA_FACTORY() {
        return { first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, email: { required: true, type: () => String, format: "email" }, phone_number: { required: true, type: () => String, minLength: 10 }, password: { required: true, type: () => String, pattern: "/^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[^\\w\\s]).{6,}$/" }, role: { required: false, type: () => String }, property_id: { required: true, type: () => String } };
    }
}
exports.CreateCustomerRepDto = CreateCustomerRepDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'John', description: 'First name of the user' }),
    (0, class_transformer_1.Transform)((val) => val.value.toLowerCase()),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateCustomerRepDto.prototype, "first_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Doe', description: 'Last name of the user' }),
    (0, class_transformer_1.Transform)((val) => val.value.toLowerCase()),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateCustomerRepDto.prototype, "last_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'user@example.com',
        description: 'Email of the user',
    }),
    (0, class_transformer_1.Transform)((val) => val.value.toLowerCase()),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsEmail)(),
    __metadata("design:type", String)
], CreateCustomerRepDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '+2348104467932',
        description: 'Phone number of the user',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(10),
    __metadata("design:type", String)
], CreateCustomerRepDto.prototype, "phone_number", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Password5%',
        description: 'Password of the user (admin only)',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Matches)(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{6,}$/, {
        message: 'Password must be at least 6 characters long, include at least one uppercase letter, one lowercase letter, one number, and one special character.',
    }),
    __metadata("design:type", String)
], CreateCustomerRepDto.prototype, "password", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'admin',
        description: 'Role of the user',
        required: false,
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)((val) => val.value.toLowerCase()),
    __metadata("design:type", String)
], CreateCustomerRepDto.prototype, "role", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the property',
        required: false,
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], CreateCustomerRepDto.prototype, "property_id", void 0);
//# sourceMappingURL=create-user.dto.js.map