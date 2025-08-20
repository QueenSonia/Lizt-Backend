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
exports.UpdateServiceRequestResponseDto = exports.UpdateServiceRequestDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const create_service_request_dto_1 = require("./create-service-request.dto");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
class UpdateServiceRequestDto extends (0, swagger_1.PartialType)(create_service_request_dto_1.CreateServiceRequestDto) {
    static _OPENAPI_METADATA_FACTORY() {
        return {};
    }
}
exports.UpdateServiceRequestDto = UpdateServiceRequestDto;
class UpdateServiceRequestResponseDto {
    tenant_name;
    property_name;
    status;
    issue_category;
    date_reported;
    resolution_date;
    description;
    issue_images;
    tenant_id;
    property_id;
    static _OPENAPI_METADATA_FACTORY() {
        return { tenant_name: { required: false, type: () => String }, property_name: { required: true, type: () => String }, status: { required: false, enum: require("./create-service-request.dto").ServiceRequestStatusEnum }, issue_category: { required: false, type: () => String }, date_reported: { required: false, type: () => Date }, resolution_date: { required: false, type: () => Date }, description: { required: false, type: () => String }, issue_images: { required: false, type: () => [String] }, tenant_id: { required: false, type: () => String }, property_id: { required: false, type: () => String } };
    }
}
exports.UpdateServiceRequestResponseDto = UpdateServiceRequestResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'John Doe',
        description: 'Name of the tenant',
        required: false,
        nullable: true,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim() || undefined),
    __metadata("design:type", String)
], UpdateServiceRequestResponseDto.prototype, "tenant_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Luxury Apartment',
        description: 'Name of the property',
        required: false,
        nullable: true,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim() || undefined),
    __metadata("design:type", String)
], UpdateServiceRequestResponseDto.prototype, "property_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'urgent',
        enum: create_service_request_dto_1.ServiceRequestStatusEnum,
        description: 'Status of the service request',
        required: false,
        nullable: true,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(create_service_request_dto_1.ServiceRequestStatusEnum),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim() || undefined),
    __metadata("design:type", String)
], UpdateServiceRequestResponseDto.prototype, "status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Carpentry',
        description: 'Category of the issue',
        required: false,
        nullable: true,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim() || undefined),
    __metadata("design:type", String)
], UpdateServiceRequestResponseDto.prototype, "issue_category", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '2024-03-21',
        description: 'Date when the issue was noticed',
        required: false,
        nullable: true,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim() || undefined),
    __metadata("design:type", Date)
], UpdateServiceRequestResponseDto.prototype, "date_reported", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '2024-03-21',
        description: 'Date when the issue was resolved',
        required: false,
        nullable: true,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim() || undefined),
    __metadata("design:type", Date)
], UpdateServiceRequestResponseDto.prototype, "resolution_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'The roof is leaking',
        description: 'Description of the issue',
        required: false,
        nullable: true,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim() || undefined),
    __metadata("design:type", String)
], UpdateServiceRequestResponseDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: 'array',
        items: { type: 'string', format: 'binary' },
        required: false,
        nullable: true,
        description: 'Images of the issue',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => {
        if (!value || value === '')
            return undefined;
        return Array.isArray(value) ? value : [value];
    }),
    __metadata("design:type", Array)
], UpdateServiceRequestResponseDto.prototype, "issue_images", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the tenant',
        required: false,
        nullable: true,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim() || undefined),
    __metadata("design:type", String)
], UpdateServiceRequestResponseDto.prototype, "tenant_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the property',
        required: false,
        nullable: true,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => value?.trim() || undefined),
    __metadata("design:type", String)
], UpdateServiceRequestResponseDto.prototype, "property_id", void 0);
//# sourceMappingURL=update-service-request.dto.js.map