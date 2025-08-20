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
exports.RentFilter = exports.CreateRentDto = exports.RentStatusEnum = exports.RentPaymentStatusEnum = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
var RentPaymentStatusEnum;
(function (RentPaymentStatusEnum) {
    RentPaymentStatusEnum["PENDING"] = "pending";
    RentPaymentStatusEnum["PAID"] = "paid";
    RentPaymentStatusEnum["OWING"] = "owing";
})(RentPaymentStatusEnum || (exports.RentPaymentStatusEnum = RentPaymentStatusEnum = {}));
var RentStatusEnum;
(function (RentStatusEnum) {
    RentStatusEnum["ACTIVE"] = "active";
    RentStatusEnum["INACTIVE"] = "inactive";
})(RentStatusEnum || (exports.RentStatusEnum = RentStatusEnum = {}));
class CreateRentDto {
    property_id;
    tenant_id;
    amount_paid;
    expiry_date;
    status;
    lease_start_date;
    lease_end_date;
    static _OPENAPI_METADATA_FACTORY() {
        return { property_id: { required: true, type: () => String, format: "uuid" }, tenant_id: { required: true, type: () => String, format: "uuid" }, amount_paid: { required: true, type: () => Number }, expiry_date: { required: true, type: () => Date }, status: { required: true, type: () => String }, lease_start_date: { required: true, type: () => Date }, lease_end_date: { required: true, type: () => Date } };
    }
}
exports.CreateRentDto = CreateRentDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the property',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateRentDto.prototype, "property_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the tenant',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], CreateRentDto.prototype, "tenant_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 500000,
        description: 'Payment of the property',
        type: 'integer',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateRentDto.prototype, "amount_paid", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '2024-03-21',
        description: 'Due date for the rent',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", Date)
], CreateRentDto.prototype, "expiry_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'pending',
        description: 'Rent status',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(RentStatusEnum),
    __metadata("design:type", String)
], CreateRentDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '',
        description: 'lease start date',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", Date)
], CreateRentDto.prototype, "lease_start_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '',
        description: 'lease end date',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", Date)
], CreateRentDto.prototype, "lease_end_date", void 0);
class RentFilter {
    page;
    size;
    tenant_id;
    owner_id;
    property_id;
    status;
    start_date;
    end_date;
    property;
    static _OPENAPI_METADATA_FACTORY() {
        return { page: { required: false, type: () => Number }, size: { required: false, type: () => Number }, tenant_id: { required: false, type: () => String }, owner_id: { required: false, type: () => String }, property_id: { required: false, type: () => String }, status: { required: false, type: () => String }, start_date: { required: false, type: () => String }, end_date: { required: false, type: () => String }, property: { required: false, type: () => ({ owner_id: { required: false, type: () => String } }) } };
    }
}
exports.RentFilter = RentFilter;
//# sourceMappingURL=create-rent.dto.js.map