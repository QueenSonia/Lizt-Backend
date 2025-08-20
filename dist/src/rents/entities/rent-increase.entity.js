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
exports.RentIncrease = void 0;
const openapi = require("@nestjs/swagger");
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../base.entity");
const property_entity_1 = require("../../properties/entities/property.entity");
let RentIncrease = class RentIncrease extends base_entity_1.BaseEntity {
    property_id;
    initial_rent;
    current_rent;
    rent_increase_date;
    reason;
    property;
    static _OPENAPI_METADATA_FACTORY() {
        return { property_id: { required: true, type: () => String }, initial_rent: { required: true, type: () => Number }, current_rent: { required: true, type: () => Number }, rent_increase_date: { required: true, type: () => Date }, reason: { required: false, type: () => String, nullable: true }, property: { required: true, type: () => require("../../properties/entities/property.entity").Property } };
    }
};
exports.RentIncrease = RentIncrease;
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], RentIncrease.prototype, "property_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: false }),
    __metadata("design:type", Number)
], RentIncrease.prototype, "initial_rent", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: false }),
    __metadata("design:type", Number)
], RentIncrease.prototype, "current_rent", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'timestamp' }),
    __metadata("design:type", Date)
], RentIncrease.prototype, "rent_increase_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'text' }),
    __metadata("design:type", Object)
], RentIncrease.prototype, "reason", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => property_entity_1.Property, (p) => p.rent_increases),
    (0, typeorm_1.JoinColumn)({ name: 'property_id', referencedColumnName: 'id' }),
    __metadata("design:type", property_entity_1.Property)
], RentIncrease.prototype, "property", void 0);
exports.RentIncrease = RentIncrease = __decorate([
    (0, typeorm_1.Entity)({ name: 'rent_increases' })
], RentIncrease);
//# sourceMappingURL=rent-increase.entity.js.map