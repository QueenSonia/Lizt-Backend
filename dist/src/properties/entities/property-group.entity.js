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
exports.PropertyGroup = void 0;
const openapi = require("@nestjs/swagger");
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../base.entity");
const user_entity_1 = require("../../users/entities/user.entity");
let PropertyGroup = class PropertyGroup extends base_entity_1.BaseEntity {
    name;
    owner_id;
    property_ids;
    owner;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String }, owner_id: { required: true, type: () => String }, property_ids: { required: true, type: () => [String] }, owner: { required: true, type: () => require("../../users/entities/user.entity").Users } };
    }
};
exports.PropertyGroup = PropertyGroup;
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], PropertyGroup.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], PropertyGroup.prototype, "owner_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid', array: true }),
    __metadata("design:type", Array)
], PropertyGroup.prototype, "property_ids", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => user_entity_1.Users),
    (0, typeorm_1.JoinColumn)({ name: 'owner_id', referencedColumnName: 'id' }),
    __metadata("design:type", user_entity_1.Users)
], PropertyGroup.prototype, "owner", void 0);
exports.PropertyGroup = PropertyGroup = __decorate([
    (0, typeorm_1.Entity)({ name: 'property_groups' })
], PropertyGroup);
//# sourceMappingURL=property-group.entity.js.map