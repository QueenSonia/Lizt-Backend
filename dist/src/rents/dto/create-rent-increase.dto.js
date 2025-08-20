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
exports.CreateRentIncreaseDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
class CreateRentIncreaseDto {
    property_id;
    initial_rent;
    current_rent;
    reason;
    static _OPENAPI_METADATA_FACTORY() {
        return { property_id: { required: true, type: () => String }, initial_rent: { required: true, type: () => Number }, current_rent: { required: true, type: () => Number }, reason: { required: false, type: () => String, nullable: true } };
    }
}
exports.CreateRentIncreaseDto = CreateRentIncreaseDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the property',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateRentIncreaseDto.prototype, "property_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 500000,
        description: 'Initial rent amount',
        type: 'integer',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateRentIncreaseDto.prototype, "initial_rent", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 600000,
        description: 'New rent amount after increase',
        type: 'integer',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreateRentIncreaseDto.prototype, "current_rent", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Annual rent review increase',
        description: 'Reason for rent increase',
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", Object)
], CreateRentIncreaseDto.prototype, "reason", void 0);
//# sourceMappingURL=create-rent-increase.dto.js.map