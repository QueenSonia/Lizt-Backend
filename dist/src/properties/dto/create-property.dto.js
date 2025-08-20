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
exports.TenantStatusEnum = exports.CreatePropertyDto = exports.PropertyStatusEnum = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
var PropertyStatusEnum;
(function (PropertyStatusEnum) {
    PropertyStatusEnum["VACANT"] = "vacant";
    PropertyStatusEnum["NOT_VACANT"] = "occupied";
})(PropertyStatusEnum || (exports.PropertyStatusEnum = PropertyStatusEnum = {}));
class CreatePropertyDto {
    name;
    location;
    description;
    property_type;
    no_of_bedrooms;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String }, location: { required: true, type: () => String }, description: { required: true, type: () => String }, property_type: { required: true, type: () => String }, no_of_bedrooms: { required: true, type: () => Number } };
    }
}
exports.CreatePropertyDto = CreatePropertyDto;
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'Abuja Duplex', description: 'Name of the property' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreatePropertyDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'lagos', description: 'Location of the property' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreatePropertyDto.prototype, "location", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 'lagos', description: 'Description of the property' }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreatePropertyDto.prototype, "description", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Duplex',
        description: 'Type of the property',
    }),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreatePropertyDto.prototype, "property_type", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 3,
        description: 'No of bedrooms in the property',
        type: 'integer',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], CreatePropertyDto.prototype, "no_of_bedrooms", void 0);
var TenantStatusEnum;
(function (TenantStatusEnum) {
    TenantStatusEnum["ACTIVE"] = "active";
    TenantStatusEnum["INACTIVE"] = "inactive";
})(TenantStatusEnum || (exports.TenantStatusEnum = TenantStatusEnum = {}));
//# sourceMappingURL=create-property.dto.js.map