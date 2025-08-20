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
exports.UploadFileDto = exports.IsTrueConstraint = exports.PaginationQueryDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
class PaginationQueryDto {
    page = 1;
    limit = 10;
    static _OPENAPI_METADATA_FACTORY() {
        return { page: { required: false, type: () => Number, default: 1, minimum: 1 }, limit: { required: false, type: () => Number, default: 10, minimum: 1 } };
    }
}
exports.PaginationQueryDto = PaginationQueryDto;
__decorate([
    (0, class_validator_1.IsNumber)({ allowInfinity: false }),
    (0, class_validator_1.Min)(1, { message: 'Page must be at least 1' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (value ? parseInt(value, 10) : 1)),
    __metadata("design:type", Number)
], PaginationQueryDto.prototype, "page", void 0);
__decorate([
    (0, class_validator_1.IsNumber)({ allowInfinity: false }),
    (0, class_validator_1.Min)(1, { message: 'Limit must be at least 1' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_transformer_1.Transform)(({ value }) => (value ? parseInt(value, 10) : 10)),
    __metadata("design:type", Number)
], PaginationQueryDto.prototype, "limit", void 0);
let IsTrueConstraint = class IsTrueConstraint {
    validate(value) {
        return value === true;
    }
    static _OPENAPI_METADATA_FACTORY() {
        return {};
    }
};
exports.IsTrueConstraint = IsTrueConstraint;
exports.IsTrueConstraint = IsTrueConstraint = __decorate([
    (0, class_validator_1.ValidatorConstraint)({ name: 'IsTrue', async: false })
], IsTrueConstraint);
class UploadFileDto {
    file;
    static _OPENAPI_METADATA_FACTORY() {
        return { file: { required: true, type: () => Object } };
    }
}
exports.UploadFileDto = UploadFileDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        type: 'string',
        format: 'binary',
        description: 'File to upload',
    }),
    __metadata("design:type", Object)
], UploadFileDto.prototype, "file", void 0);
//# sourceMappingURL=utils.dto.js.map