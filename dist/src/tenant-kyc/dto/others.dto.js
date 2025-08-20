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
exports.BulkDeleteTenantKycDto = exports.ParseTenantKycQueryDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const utils_dto_1 = require("../../lib/utils/re-usables/utils.dto");
class ParseTenantKycQueryDto extends utils_dto_1.PaginationQueryDto {
    fields;
    static _OPENAPI_METADATA_FACTORY() {
        return { fields: { required: false, type: () => String, description: "Comma seperated string of table column names (or model property names)", example: "id,first_name,email" } };
    }
}
exports.ParseTenantKycQueryDto = ParseTenantKycQueryDto;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_transformer_1.Transform)(({ value }) => typeof value === 'string' && value?.trim()),
    __metadata("design:type", String)
], ParseTenantKycQueryDto.prototype, "fields", void 0);
class BulkDeleteTenantKycDto {
    ids;
    static _OPENAPI_METADATA_FACTORY() {
        return { ids: { required: true, type: () => [String], minItems: 1, format: "uuid" } };
    }
}
exports.BulkDeleteTenantKycDto = BulkDeleteTenantKycDto;
__decorate([
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayNotEmpty)(),
    (0, class_validator_1.IsUUID)('all', { each: true }),
    __metadata("design:type", Array)
], BulkDeleteTenantKycDto.prototype, "ids", void 0);
//# sourceMappingURL=others.dto.js.map