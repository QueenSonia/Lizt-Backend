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
exports.Rent = void 0;
const openapi = require("@nestjs/swagger");
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../base.entity");
const property_entity_1 = require("../../properties/entities/property.entity");
const create_rent_dto_1 = require("../dto/create-rent.dto");
const account_entity_1 = require("../../users/entities/account.entity");
let Rent = class Rent extends base_entity_1.BaseEntity {
    property_id;
    tenant_id;
    amount_paid;
    expiry_date;
    lease_start_date;
    lease_end_date;
    rent_receipts;
    rental_price;
    security_deposit;
    service_charge;
    payment_status;
    rent_status;
    property;
    tenant;
    static _OPENAPI_METADATA_FACTORY() {
        return { property_id: { required: true, type: () => String }, tenant_id: { required: true, type: () => String }, amount_paid: { required: true, type: () => Number }, expiry_date: { required: true, type: () => Date }, lease_start_date: { required: true, type: () => Date }, lease_end_date: { required: true, type: () => Date }, rent_receipts: { required: false, type: () => [String], nullable: true }, rental_price: { required: true, type: () => Number }, security_deposit: { required: true, type: () => Number }, service_charge: { required: true, type: () => Number }, payment_status: { required: true, type: () => String }, rent_status: { required: true, type: () => String }, property: { required: true, type: () => require("../../properties/entities/property.entity").Property }, tenant: { required: true, type: () => require("../../users/entities/account.entity").Account } };
    }
};
exports.Rent = Rent;
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], Rent.prototype, "property_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], Rent.prototype, "tenant_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: false }),
    __metadata("design:type", Number)
], Rent.prototype, "amount_paid", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'timestamp' }),
    __metadata("design:type", Date)
], Rent.prototype, "expiry_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'timestamp' }),
    __metadata("design:type", Date)
], Rent.prototype, "lease_start_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'timestamp' }),
    __metadata("design:type", Date)
], Rent.prototype, "lease_end_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar', array: true }),
    __metadata("design:type", Object)
], Rent.prototype, "rent_receipts", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Rent.prototype, "rental_price", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Rent.prototype, "security_deposit", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Rent.prototype, "service_charge", void 0);
__decorate([
    (0, typeorm_1.Column)({
        nullable: false,
        type: 'enum',
        enum: [create_rent_dto_1.RentPaymentStatusEnum.PENDING, create_rent_dto_1.RentPaymentStatusEnum.PAID, create_rent_dto_1.RentPaymentStatusEnum.OWING],
        default: create_rent_dto_1.RentPaymentStatusEnum.PENDING,
    }),
    __metadata("design:type", String)
], Rent.prototype, "payment_status", void 0);
__decorate([
    (0, typeorm_1.Column)({
        nullable: false,
        type: 'enum',
        enum: [create_rent_dto_1.RentStatusEnum.INACTIVE, create_rent_dto_1.RentStatusEnum.ACTIVE],
        default: create_rent_dto_1.RentStatusEnum.INACTIVE,
    }),
    __metadata("design:type", String)
], Rent.prototype, "rent_status", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => property_entity_1.Property, (p) => p.rents, {
        onDelete: 'CASCADE',
    }),
    (0, typeorm_1.JoinColumn)({ name: 'property_id', referencedColumnName: 'id' }),
    __metadata("design:type", property_entity_1.Property)
], Rent.prototype, "property", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => account_entity_1.Account, (u) => u.rents),
    (0, typeorm_1.JoinColumn)({ name: 'tenant_id', referencedColumnName: 'id' }),
    __metadata("design:type", account_entity_1.Account)
], Rent.prototype, "tenant", void 0);
exports.Rent = Rent = __decorate([
    (0, typeorm_1.Entity)({ name: 'rents' })
], Rent);
//# sourceMappingURL=rent.entity.js.map