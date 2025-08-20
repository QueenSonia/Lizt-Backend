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
exports.RolesEnum = exports.ADMIN_ROLES = exports.BaseEntity = void 0;
const openapi = require("@nestjs/swagger");
const typeorm_1 = require("typeorm");
class BaseEntity {
    id;
    created_at;
    updated_at;
    deleted_at;
    static _OPENAPI_METADATA_FACTORY() {
        return { id: { required: true, type: () => String }, created_at: { required: false, type: () => Object }, updated_at: { required: false, type: () => Object }, deleted_at: { required: false, type: () => Date } };
    }
}
exports.BaseEntity = BaseEntity;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], BaseEntity.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)(),
    __metadata("design:type", Object)
], BaseEntity.prototype, "created_at", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)(),
    __metadata("design:type", Object)
], BaseEntity.prototype, "updated_at", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: null, nullable: true }),
    __metadata("design:type", Date)
], BaseEntity.prototype, "deleted_at", void 0);
var ADMIN_ROLES;
(function (ADMIN_ROLES) {
    ADMIN_ROLES["ADMIN"] = "admin";
})(ADMIN_ROLES || (exports.ADMIN_ROLES = ADMIN_ROLES = {}));
var RolesEnum;
(function (RolesEnum) {
    RolesEnum["ADMIN"] = "admin";
    RolesEnum["TENANT"] = "tenant";
    RolesEnum["REP"] = "rep";
    RolesEnum["FACILITY_MANAGER"] = "facility_manager";
})(RolesEnum || (exports.RolesEnum = RolesEnum = {}));
//# sourceMappingURL=base.entity.js.map