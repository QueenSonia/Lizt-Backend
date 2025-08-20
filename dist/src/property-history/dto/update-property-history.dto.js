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
exports.UpdatePropertyHistoryResponseDto = exports.UpdatePropertyHistoryDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const create_property_history_dto_1 = require("./create-property-history.dto");
const property_history_entity_1 = require("../entities/property-history.entity");
class UpdatePropertyHistoryDto extends (0, swagger_1.PartialType)(create_property_history_dto_1.CreatePropertyHistoryDto) {
    static _OPENAPI_METADATA_FACTORY() {
        return {};
    }
}
exports.UpdatePropertyHistoryDto = UpdatePropertyHistoryDto;
class UpdatePropertyHistoryResponseDto {
    property_id;
    tenant_id;
    move_in_date;
    move_out_date;
    move_out_reason;
    owner_comment;
    tenant_comment;
    monthly_rent;
    static _OPENAPI_METADATA_FACTORY() {
        return { property_id: { required: true, type: () => String }, tenant_id: { required: true, type: () => String }, move_in_date: { required: true, type: () => Object }, move_out_date: { required: false, type: () => Object }, move_out_reason: { required: false, nullable: true }, owner_comment: { required: false, type: () => String, nullable: true }, tenant_comment: { required: false, type: () => String, nullable: true }, monthly_rent: { required: true, type: () => Number } };
    }
}
exports.UpdatePropertyHistoryResponseDto = UpdatePropertyHistoryResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the property',
        required: false,
    }),
    __metadata("design:type", String)
], UpdatePropertyHistoryResponseDto.prototype, "property_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the tenant',
        required: false,
    }),
    __metadata("design:type", String)
], UpdatePropertyHistoryResponseDto.prototype, "tenant_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '2024-01-01',
        description: 'Date tenant moved in',
        required: false,
    }),
    __metadata("design:type", Object)
], UpdatePropertyHistoryResponseDto.prototype, "move_in_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '2024-12-31',
        description: 'Move out date',
        required: false,
    }),
    __metadata("design:type", Object)
], UpdatePropertyHistoryResponseDto.prototype, "move_out_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        enum: property_history_entity_1.MoveOutReasonEnum,
        example: property_history_entity_1.MoveOutReasonEnum.LEASE_ENDED,
        description: 'Reason for moving out',
        required: false,
    }),
    __metadata("design:type", Object)
], UpdatePropertyHistoryResponseDto.prototype, "move_out_reason", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Great tenant, always paid on time',
        description: 'Comment from the owner',
        required: false,
    }),
    __metadata("design:type", Object)
], UpdatePropertyHistoryResponseDto.prototype, "owner_comment", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Wonderful property and management',
        description: 'Comment from the tenant',
        required: false,
    }),
    __metadata("design:type", Object)
], UpdatePropertyHistoryResponseDto.prototype, "tenant_comment", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 50000,
        description: 'Monthly rent amount',
        type: 'integer',
        required: false,
    }),
    __metadata("design:type", Number)
], UpdatePropertyHistoryResponseDto.prototype, "monthly_rent", void 0);
//# sourceMappingURL=update-property-history.dto.js.map