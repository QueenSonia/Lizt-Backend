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
exports.PaginationResponseDto = exports.PaginationMetadataDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const create_property_dto_1 = require("./create-property.dto");
class PaginationMetadataDto {
    totalRows;
    perPage;
    currentPage;
    totalPages;
    hasNextPage;
    static _OPENAPI_METADATA_FACTORY() {
        return { totalRows: { required: true, type: () => Number }, perPage: { required: true, type: () => Number }, currentPage: { required: true, type: () => Number }, totalPages: { required: true, type: () => Number }, hasNextPage: { required: true, type: () => Boolean } };
    }
}
exports.PaginationMetadataDto = PaginationMetadataDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 100,
        description: 'The total number of properties',
    }),
    __metadata("design:type", Number)
], PaginationMetadataDto.prototype, "totalRows", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: 10,
        description: 'Number of properties per page',
    }),
    __metadata("design:type", Number)
], PaginationMetadataDto.prototype, "perPage", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 1, description: 'Current page number' }),
    __metadata("design:type", Number)
], PaginationMetadataDto.prototype, "currentPage", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ example: 10, description: 'Total number of pages' }),
    __metadata("design:type", Number)
], PaginationMetadataDto.prototype, "totalPages", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        example: true,
        description: 'Indicates if there is a next page',
    }),
    __metadata("design:type", Boolean)
], PaginationMetadataDto.prototype, "hasNextPage", void 0);
class PaginationResponseDto {
    users;
    pagination;
    static _OPENAPI_METADATA_FACTORY() {
        return { users: { required: true, type: () => [require("./create-property.dto").CreatePropertyDto] }, pagination: { required: true, type: () => require("./paginate.dto").PaginationMetadataDto } };
    }
}
exports.PaginationResponseDto = PaginationResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({
        type: [create_property_dto_1.CreatePropertyDto],
        description: 'Array of property objects',
    }),
    __metadata("design:type", Array)
], PaginationResponseDto.prototype, "users", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({
        type: PaginationMetadataDto,
        description: 'Pagination metadata',
    }),
    __metadata("design:type", PaginationMetadataDto)
], PaginationResponseDto.prototype, "pagination", void 0);
//# sourceMappingURL=paginate.dto.js.map