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
exports.PaginationResponseDto = void 0;
const openapi = require("@nestjs/swagger");
const swagger_1 = require("@nestjs/swagger");
const rent_entity_1 = require("../entities/rent.entity");
class PaginationDto {
    totalRows;
    perPage;
    currentPage;
    totalPages;
    hasNextPage;
    static _OPENAPI_METADATA_FACTORY() {
        return { totalRows: { required: true, type: () => Number }, perPage: { required: true, type: () => Number }, currentPage: { required: true, type: () => Number }, totalPages: { required: true, type: () => Number }, hasNextPage: { required: true, type: () => Boolean } };
    }
}
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PaginationDto.prototype, "totalRows", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PaginationDto.prototype, "perPage", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PaginationDto.prototype, "currentPage", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], PaginationDto.prototype, "totalPages", void 0);
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Boolean)
], PaginationDto.prototype, "hasNextPage", void 0);
class PaginationResponseDto {
    rents;
    pagination;
    static _OPENAPI_METADATA_FACTORY() {
        return { rents: { required: true, type: () => [require("../entities/rent.entity").Rent] }, pagination: { required: true, type: () => PaginationDto } };
    }
}
exports.PaginationResponseDto = PaginationResponseDto;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [rent_entity_1.Rent] }),
    __metadata("design:type", Array)
], PaginationResponseDto.prototype, "rents", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: PaginationDto }),
    __metadata("design:type", PaginationDto)
], PaginationResponseDto.prototype, "pagination", void 0);
//# sourceMappingURL=paginate.dto.js.map