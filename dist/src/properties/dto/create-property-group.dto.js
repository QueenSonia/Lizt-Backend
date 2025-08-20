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
exports.PropertyGroupFilter = exports.CreatePropertyGroupDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
class CreatePropertyGroupDto {
    name;
    property_ids;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String }, property_ids: { required: true, type: () => [String] } };
    }
}
exports.CreatePropertyGroupDto = CreatePropertyGroupDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 'Luxury Properties',
        description: 'Name of the property group',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreatePropertyGroupDto.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: [String],
        example: ['uuid1', 'uuid2'],
        description: 'Array of property IDs to be grouped',
    }),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.IsArray)(),
    __metadata("design:type", Array)
], CreatePropertyGroupDto.prototype, "property_ids", void 0);
class PropertyGroupFilter {
    owner_id;
    name;
    static _OPENAPI_METADATA_FACTORY() {
        return { owner_id: { required: false, type: () => String }, name: { required: false, type: () => String } };
    }
}
exports.PropertyGroupFilter = PropertyGroupFilter;
//# sourceMappingURL=create-property-group.dto.js.map