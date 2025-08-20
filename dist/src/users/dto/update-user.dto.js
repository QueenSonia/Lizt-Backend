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
exports.UpdateUserResponseDto = exports.UpdateUserDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const create_user_dto_1 = require("./create-user.dto");
class UpdateUserDto extends (0, swagger_1.PartialType)(create_user_dto_1.CreateUserDto) {
    static _OPENAPI_METADATA_FACTORY() {
        return {};
    }
}
exports.UpdateUserDto = UpdateUserDto;
class UpdateUserResponseDto {
    first_name;
    last_name;
    email;
    phone_number;
    role;
    lease_start_date;
    lease_end_date;
    property_id;
    static _OPENAPI_METADATA_FACTORY() {
        return { first_name: { required: true, type: () => String }, last_name: { required: true, type: () => String }, email: { required: true, type: () => String }, phone_number: { required: true, type: () => String }, role: { required: true, type: () => String }, lease_start_date: { required: true, type: () => Date }, lease_end_date: { required: true, type: () => Date }, property_id: { required: true, type: () => String } };
    }
}
exports.UpdateUserResponseDto = UpdateUserResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        required: false,
        example: 'John',
        description: 'First name of the user',
    }),
    __metadata("design:type", String)
], UpdateUserResponseDto.prototype, "first_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        required: false,
        example: 'Doe',
        description: 'Last name of the user',
    }),
    __metadata("design:type", String)
], UpdateUserResponseDto.prototype, "last_name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        required: false,
        example: 'user@example.com',
        description: 'Email of the user',
    }),
    __metadata("design:type", String)
], UpdateUserResponseDto.prototype, "email", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        required: false,
        example: '+2348104467932',
        description: 'Phone number of the user',
    }),
    __metadata("design:type", String)
], UpdateUserResponseDto.prototype, "phone_number", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        required: false,
        example: 'admin',
        description: 'Role of the user',
    }),
    __metadata("design:type", String)
], UpdateUserResponseDto.prototype, "role", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '2023-10-01',
        required: false,
        description: 'lease start date',
    }),
    __metadata("design:type", Date)
], UpdateUserResponseDto.prototype, "lease_start_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '2024-10-01',
        required: false,
        description: 'lease end date',
    }),
    __metadata("design:type", Date)
], UpdateUserResponseDto.prototype, "lease_end_date", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the property',
        required: false,
    }),
    __metadata("design:type", String)
], UpdateUserResponseDto.prototype, "property_id", void 0);
//# sourceMappingURL=update-user.dto.js.map