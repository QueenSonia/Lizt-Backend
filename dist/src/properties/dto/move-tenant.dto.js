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
exports.MoveTenantOutDto = exports.MoveTenantInDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const property_history_entity_1 = require("../../property-history/entities/property-history.entity");
class MoveTenantInDto {
    property_id;
    tenant_id;
    move_in_date;
    static _OPENAPI_METADATA_FACTORY() {
        return { property_id: { required: true, type: () => String }, tenant_id: { required: true, type: () => String }, move_in_date: { required: true, type: () => String } };
    }
}
exports.MoveTenantInDto = MoveTenantInDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the property',
        required: true,
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], MoveTenantInDto.prototype, "property_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the tenant that is moving in',
        required: true,
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], MoveTenantInDto.prototype, "tenant_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '2024-03-21',
        description: 'Date tenant moved in',
        required: true,
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], MoveTenantInDto.prototype, "move_in_date", void 0);
class MoveTenantOutDto {
    property_id;
    tenant_id;
    move_out_date;
    move_out_reason;
    owner_comment;
    tenant_comment;
    static _OPENAPI_METADATA_FACTORY() {
        return { property_id: { required: true, type: () => String }, tenant_id: { required: true, type: () => String }, move_out_date: { required: true, type: () => String }, move_out_reason: { required: false, type: () => String }, owner_comment: { required: false, type: () => String }, tenant_comment: { required: false, type: () => String } };
    }
}
exports.MoveTenantOutDto = MoveTenantOutDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the property',
        required: true,
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], MoveTenantOutDto.prototype, "property_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the tenant that is moving out',
        required: true,
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], MoveTenantOutDto.prototype, "tenant_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '2024-03-21',
        description: 'Date tenant moved out',
        required: true,
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], MoveTenantOutDto.prototype, "move_out_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        enum: property_history_entity_1.MoveOutReasonEnum,
        example: property_history_entity_1.MoveOutReasonEnum.LEASE_ENDED,
        description: 'Reason for moving out',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsEnum)(property_history_entity_1.MoveOutReasonEnum),
    __metadata("design:type", String)
], MoveTenantOutDto.prototype, "move_out_reason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Great tenant, always paid on time',
        description: 'Comment from the owner',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], MoveTenantOutDto.prototype, "owner_comment", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Wonderful property and management',
        description: 'Comment from the tenant',
        required: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], MoveTenantOutDto.prototype, "tenant_comment", void 0);
//# sourceMappingURL=move-tenant.dto.js.map