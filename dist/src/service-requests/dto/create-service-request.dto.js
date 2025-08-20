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
exports.ServiceRequestFilter = exports.CreateServiceRequestDto = exports.ServiceRequestStatusEnum = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
var ServiceRequestStatusEnum;
(function (ServiceRequestStatusEnum) {
    ServiceRequestStatusEnum["PENDING"] = "pending";
    ServiceRequestStatusEnum["IN_PROGRESS"] = "in_progress";
    ServiceRequestStatusEnum["RESOLVED"] = "resolved";
    ServiceRequestStatusEnum["URGENT"] = "urgent";
})(ServiceRequestStatusEnum || (exports.ServiceRequestStatusEnum = ServiceRequestStatusEnum = {}));
class CreateServiceRequestDto {
    tenant_name;
    property_name;
    issue_category;
    date_reported;
    description;
    issue_images;
    status;
    tenant_id;
    property_id;
    static _OPENAPI_METADATA_FACTORY() {
        return { tenant_name: { required: true, type: () => String }, property_name: { required: true, type: () => String }, issue_category: { required: true, type: () => String }, date_reported: { required: true, type: () => Date }, description: { required: true, type: () => String }, issue_images: { required: false, type: () => [String], nullable: true }, status: { required: false, type: () => String, nullable: true }, tenant_id: { required: true, type: () => String }, property_id: { required: true, type: () => String } };
    }
}
exports.CreateServiceRequestDto = CreateServiceRequestDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'John Doe', description: 'Name of the tenant' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateServiceRequestDto.prototype, "tenant_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Luxury Apartment',
        description: 'Name of the property',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateServiceRequestDto.prototype, "property_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Broken Pipe',
        description: 'Category of the issue',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateServiceRequestDto.prototype, "issue_category", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '2024-03-21',
        description: 'Date when the issue was noticed',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", Date)
], CreateServiceRequestDto.prototype, "date_reported", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'The pipe in the kitchen is leaking and needs immediate attention.',
        description: 'Description of the issue',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateServiceRequestDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: 'array',
        items: { type: 'string', format: 'binary' },
        required: false,
        description: 'Images of the issue (optional)',
    }),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Object)
], CreateServiceRequestDto.prototype, "issue_images", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'pending',
        description: 'Status of the service request',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", Object)
], CreateServiceRequestDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the tenant',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateServiceRequestDto.prototype, "tenant_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the property',
    }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], CreateServiceRequestDto.prototype, "property_id", void 0);
class ServiceRequestFilter {
    tenant_id;
    property_id;
    status;
    start_date;
    end_date;
    page;
    size;
    static _OPENAPI_METADATA_FACTORY() {
        return { tenant_id: { required: false, type: () => String, format: "uuid" }, property_id: { required: false, type: () => String, format: "uuid" }, status: { required: false, type: () => String }, start_date: { required: false, type: () => String }, end_date: { required: false, type: () => String }, page: { required: false, type: () => Number }, size: { required: false, type: () => Number } };
    }
}
exports.ServiceRequestFilter = ServiceRequestFilter;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (value === '' ? undefined : value)),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], ServiceRequestFilter.prototype, "tenant_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (value === '' ? undefined : value)),
    (0, class_validator_1.IsUUID)(),
    __metadata("design:type", String)
], ServiceRequestFilter.prototype, "property_id", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], ServiceRequestFilter.prototype, "status", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], ServiceRequestFilter.prototype, "start_date", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], ServiceRequestFilter.prototype, "end_date", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], ServiceRequestFilter.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Type)(() => Number),
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", Number)
], ServiceRequestFilter.prototype, "size", void 0);
//# sourceMappingURL=create-service-request.dto.js.map