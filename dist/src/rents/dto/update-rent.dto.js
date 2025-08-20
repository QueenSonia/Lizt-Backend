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
exports.UpdateRentResponseDto = exports.UpdateRentDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const create_rent_dto_1 = require("./create-rent.dto");
class UpdateRentDto extends (0, swagger_1.PartialType)(create_rent_dto_1.CreateRentDto) {
    static _OPENAPI_METADATA_FACTORY() {
        return {};
    }
}
exports.UpdateRentDto = UpdateRentDto;
class UpdateRentResponseDto {
    property_id;
    tenant_id;
    amount_paid;
    expiry_date;
    status;
    static _OPENAPI_METADATA_FACTORY() {
        return { property_id: { required: true, type: () => String }, tenant_id: { required: true, type: () => String }, amount_paid: { required: true, type: () => Number }, expiry_date: { required: true, type: () => Date }, status: { required: true, type: () => String } };
    }
}
exports.UpdateRentResponseDto = UpdateRentResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the property',
        required: false,
    }),
    __metadata("design:type", String)
], UpdateRentResponseDto.prototype, "property_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the tenant',
        required: false,
    }),
    __metadata("design:type", String)
], UpdateRentResponseDto.prototype, "tenant_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '500000',
        description: 'Payment of the property',
        required: false,
    }),
    __metadata("design:type", Number)
], UpdateRentResponseDto.prototype, "amount_paid", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '2024-03-21',
        description: 'Due date for the rent',
        required: false,
    }),
    __metadata("design:type", Date)
], UpdateRentResponseDto.prototype, "expiry_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Pending',
        description: 'Rent status',
        required: false,
    }),
    __metadata("design:type", String)
], UpdateRentResponseDto.prototype, "status", void 0);
//# sourceMappingURL=update-rent.dto.js.map