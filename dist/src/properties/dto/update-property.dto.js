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
exports.UpdatePropertyResponseDto = exports.UpdatePropertyDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const create_property_dto_1 = require("./create-property.dto");
const class_validator_1 = require("class-validator");
const swagger_2 = require("@nestjs/swagger");
const create_rent_dto_1 = require("../../rents/dto/create-rent.dto");
class UpdatePropertyDto {
    id;
    name;
    description;
    location;
    rent_status;
    property_type;
    rental_price;
    service_charge;
    security_deposit;
    tenant_name;
    phone_number;
    occupancy_status;
    no_of_bedrooms;
    lease_start_date;
    lease_end_date;
    lease_duration;
    first_name;
    last_name;
    static _OPENAPI_METADATA_FACTORY() {
        return { id: { required: false, type: () => String, format: "uuid" }, name: { required: false, type: () => String }, description: { required: false, type: () => String }, location: { required: false, type: () => String }, rent_status: { required: false, enum: require("../../rents/dto/create-rent.dto").RentStatusEnum }, property_type: { required: false, type: () => String }, rental_price: { required: false, type: () => Number }, service_charge: { required: false, type: () => Number }, security_deposit: { required: false, type: () => Number }, tenant_name: { required: false, type: () => String }, phone_number: { required: false, type: () => String }, occupancy_status: { required: false, enum: require("./create-property.dto").PropertyStatusEnum }, no_of_bedrooms: { required: false, type: () => Number }, lease_start_date: { required: false, type: () => String }, lease_end_date: { required: false, type: () => String }, lease_duration: { required: false, type: () => String }, first_name: { required: false, type: () => String }, last_name: { required: false, type: () => String } };
    }
}
exports.UpdatePropertyDto = UpdatePropertyDto;
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ format: 'uuid' }),
    (0, class_validator_1.IsUUID)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "id", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "name", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "description", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "location", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ enum: create_rent_dto_1.RentStatusEnum }),
    (0, class_validator_1.IsEnum)(create_rent_dto_1.RentStatusEnum),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "rent_status", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "property_type", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ type: Number, example: 1000000 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], UpdatePropertyDto.prototype, "rental_price", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ type: Number, example: 50000 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], UpdatePropertyDto.prototype, "service_charge", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ type: Number, example: 50000 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], UpdatePropertyDto.prototype, "security_deposit", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "tenant_name", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ example: '08104228894' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "phone_number", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ example: 'active' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "occupancy_status", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ example: 3 }),
    (0, class_validator_1.IsNumber)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", Number)
], UpdatePropertyDto.prototype, "no_of_bedrooms", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ type: String, format: 'date-time', example: '2025-05-10T00:00:00.000Z' }),
    (0, class_validator_1.IsDateString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "lease_start_date", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ type: String, format: 'date-time', example: '2025-12-10T00:00:00.000Z' }),
    (0, class_validator_1.IsDateString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "lease_end_date", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)({ example: '7 months' }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "lease_duration", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "first_name", void 0);
__decorate([
    (0, swagger_2.ApiPropertyOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], UpdatePropertyDto.prototype, "last_name", void 0);
class UpdatePropertyResponseDto {
    name;
    location;
    property_status;
    owner_id;
    property_type;
    property_images;
    no_of_bedrooms;
    rental_price;
    payment_frequency;
    security_deposit;
    service_charge;
    comment;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String }, location: { required: true, type: () => String }, property_status: { required: true, enum: require("./create-property.dto").PropertyStatusEnum }, owner_id: { required: true, type: () => String }, property_type: { required: true, type: () => String }, property_images: { required: true, type: () => [String] }, no_of_bedrooms: { required: true, type: () => Number }, rental_price: { required: true, type: () => Number }, payment_frequency: { required: true, type: () => String }, security_deposit: { required: true, type: () => Number }, service_charge: { required: true, type: () => Number }, comment: { required: false, type: () => String, nullable: true } };
    }
}
exports.UpdatePropertyResponseDto = UpdatePropertyResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Abuja Duplex',
        description: 'Name of the property',
        required: false,
    }),
    __metadata("design:type", String)
], UpdatePropertyResponseDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'lagos',
        description: 'Location of the property',
        required: false,
    }),
    __metadata("design:type", String)
], UpdatePropertyResponseDto.prototype, "location", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'vacant',
        description: 'Status of the property',
        required: false,
    }),
    __metadata("design:type", String)
], UpdatePropertyResponseDto.prototype, "property_status", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: '90b7f325-be27-45a7-9688-fa49630cac8f',
        description: 'UUID of the tenant',
        required: false,
    }),
    __metadata("design:type", String)
], UpdatePropertyResponseDto.prototype, "owner_id", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Duplex',
        description: 'Type of the property',
        required: false,
    }),
    __metadata("design:type", String)
], UpdatePropertyResponseDto.prototype, "property_type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: 'array',
        items: { type: 'string', format: 'binary' },
        required: false,
        description: 'Images of the property',
    }),
    __metadata("design:type", Array)
], UpdatePropertyResponseDto.prototype, "property_images", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 3,
        description: 'No of bedrooms in the property',
        required: false,
    }),
    __metadata("design:type", Number)
], UpdatePropertyResponseDto.prototype, "no_of_bedrooms", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 500000,
        description: 'Rental price of the property',
        required: false,
    }),
    __metadata("design:type", Number)
], UpdatePropertyResponseDto.prototype, "rental_price", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'monthly',
        description: 'Frequency of payment for the property',
        required: false,
    }),
    __metadata("design:type", String)
], UpdatePropertyResponseDto.prototype, "payment_frequency", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 20000,
        description: 'Security payment',
        required: false,
    }),
    __metadata("design:type", Number)
], UpdatePropertyResponseDto.prototype, "security_deposit", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 50000,
        description: 'Service charge',
        required: false,
    }),
    __metadata("design:type", Number)
], UpdatePropertyResponseDto.prototype, "service_charge", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Available now',
        description: 'Comment about the property',
        required: false,
    }),
    __metadata("design:type", Object)
], UpdatePropertyResponseDto.prototype, "comment", void 0);
//# sourceMappingURL=update-property.dto.js.map