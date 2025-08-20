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
exports.PropertyHistory = exports.MoveOutReasonEnum = void 0;
const openapi = require("@nestjs/swagger");
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../base.entity");
const property_entity_1 = require("../../properties/entities/property.entity");
const account_entity_1 = require("../../users/entities/account.entity");
var MoveOutReasonEnum;
(function (MoveOutReasonEnum) {
    MoveOutReasonEnum["LEASE_ENDED"] = "lease_ended";
    MoveOutReasonEnum["EVICTION"] = "eviction";
    MoveOutReasonEnum["EARLY_TERMINATION"] = "early_termination";
    MoveOutReasonEnum["MUTUAL_AGREEMENT"] = "mutual_agreement";
    MoveOutReasonEnum["OTHER"] = "other";
})(MoveOutReasonEnum || (exports.MoveOutReasonEnum = MoveOutReasonEnum = {}));
let PropertyHistory = class PropertyHistory extends base_entity_1.BaseEntity {
    property_id;
    tenant_id;
    move_in_date;
    move_out_date;
    move_out_reason;
    owner_comment;
    tenant_comment;
    monthly_rent;
    property;
    tenant;
    static _OPENAPI_METADATA_FACTORY() {
        return { property_id: { required: true, type: () => String }, tenant_id: { required: true, type: () => String }, move_in_date: { required: true, type: () => Date }, move_out_date: { required: false, type: () => Date, nullable: true }, move_out_reason: { required: false, type: () => String, nullable: true }, owner_comment: { required: false, type: () => String, nullable: true }, tenant_comment: { required: false, type: () => String, nullable: true }, monthly_rent: { required: true, type: () => Number }, property: { required: true, type: () => require("../../properties/entities/property.entity").Property }, tenant: { required: true, type: () => require("../../users/entities/account.entity").Account } };
    }
};
exports.PropertyHistory = PropertyHistory;
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], PropertyHistory.prototype, "property_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], PropertyHistory.prototype, "tenant_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'timestamp' }),
    __metadata("design:type", Date)
], PropertyHistory.prototype, "move_in_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'timestamp' }),
    __metadata("design:type", Object)
], PropertyHistory.prototype, "move_out_date", void 0);
__decorate([
    (0, typeorm_1.Column)({
        nullable: true,
        type: 'enum',
        enum: MoveOutReasonEnum,
    }),
    __metadata("design:type", Object)
], PropertyHistory.prototype, "move_out_reason", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'text' }),
    __metadata("design:type", Object)
], PropertyHistory.prototype, "owner_comment", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'text' }),
    __metadata("design:type", Object)
], PropertyHistory.prototype, "tenant_comment", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: false }),
    __metadata("design:type", Number)
], PropertyHistory.prototype, "monthly_rent", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => property_entity_1.Property, (p) => p.property_histories, {
        onDelete: 'CASCADE',
    }),
    (0, typeorm_1.JoinColumn)({ name: 'property_id', referencedColumnName: 'id' }),
    __metadata("design:type", property_entity_1.Property)
], PropertyHistory.prototype, "property", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => account_entity_1.Account, (u) => u.property_histories),
    (0, typeorm_1.JoinColumn)({ name: 'tenant_id', referencedColumnName: 'id' }),
    __metadata("design:type", account_entity_1.Account)
], PropertyHistory.prototype, "tenant", void 0);
exports.PropertyHistory = PropertyHistory = __decorate([
    (0, typeorm_1.Entity)({ name: 'property_histories' })
], PropertyHistory);
//# sourceMappingURL=property-history.entity.js.map