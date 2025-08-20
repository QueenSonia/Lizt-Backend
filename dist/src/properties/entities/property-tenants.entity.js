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
exports.PropertyTenant = void 0;
const openapi = require("@nestjs/swagger");
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../base.entity");
const property_entity_1 = require("./property.entity");
const create_property_dto_1 = require("../dto/create-property.dto");
const account_entity_1 = require("../../users/entities/account.entity");
let PropertyTenant = class PropertyTenant extends base_entity_1.BaseEntity {
    property_id;
    tenant_id;
    status;
    property;
    tenant;
    static _OPENAPI_METADATA_FACTORY() {
        return { property_id: { required: true, type: () => String }, tenant_id: { required: true, type: () => String }, status: { required: true, enum: require("../dto/create-property.dto").TenantStatusEnum }, property: { required: true, type: () => require("./property.entity").Property }, tenant: { required: true, type: () => require("../../users/entities/account.entity").Account } };
    }
};
exports.PropertyTenant = PropertyTenant;
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], PropertyTenant.prototype, "property_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], PropertyTenant.prototype, "tenant_id", void 0);
__decorate([
    (0, typeorm_1.Column)({
        nullable: false,
        type: 'enum',
        enum: [create_property_dto_1.TenantStatusEnum.ACTIVE, create_property_dto_1.TenantStatusEnum.INACTIVE],
        default: create_property_dto_1.TenantStatusEnum.ACTIVE,
    }),
    __metadata("design:type", String)
], PropertyTenant.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => property_entity_1.Property, (p) => p.property_tenants, {
        onDelete: 'CASCADE',
    }),
    (0, typeorm_1.JoinColumn)({ name: 'property_id', referencedColumnName: 'id' }),
    __metadata("design:type", property_entity_1.Property)
], PropertyTenant.prototype, "property", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => account_entity_1.Account, (u) => u.property_tenants, {
        onDelete: 'CASCADE',
        cascade: true,
    }),
    (0, typeorm_1.JoinColumn)({ name: 'tenant_id', referencedColumnName: 'id' }),
    __metadata("design:type", account_entity_1.Account)
], PropertyTenant.prototype, "tenant", void 0);
exports.PropertyTenant = PropertyTenant = __decorate([
    (0, typeorm_1.Entity)({ name: 'property_tenants' })
], PropertyTenant);
//# sourceMappingURL=property-tenants.entity.js.map