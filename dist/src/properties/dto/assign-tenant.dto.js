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
exports.AssignTenantDto = void 0;
const openapi = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
class AssignTenantDto {
    tenant_id;
    rental_price;
    service_charge;
    security_deposit;
    lease_start_date;
    lease_end_date;
    rent_status;
    static _OPENAPI_METADATA_FACTORY() {
        return { tenant_id: { required: true, type: () => String }, rental_price: { required: true, type: () => Number }, service_charge: { required: true, type: () => Number }, security_deposit: { required: true, type: () => Number }, lease_start_date: { required: true, type: () => String }, lease_end_date: { required: true, type: () => String }, rent_status: { required: true, type: () => String } };
    }
}
exports.AssignTenantDto = AssignTenantDto;
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AssignTenantDto.prototype, "tenant_id", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], AssignTenantDto.prototype, "rental_price", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], AssignTenantDto.prototype, "service_charge", void 0);
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], AssignTenantDto.prototype, "security_deposit", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AssignTenantDto.prototype, "lease_start_date", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AssignTenantDto.prototype, "lease_end_date", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], AssignTenantDto.prototype, "rent_status", void 0);
//# sourceMappingURL=assign-tenant.dto.js.map