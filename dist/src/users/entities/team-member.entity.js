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
exports.TeamMember = void 0;
const openapi = require("@nestjs/swagger");
const base_entity_1 = require("../../base.entity");
const typeorm_1 = require("typeorm");
const account_entity_1 = require("./account.entity");
const team_entity_1 = require("./team.entity");
let TeamMember = class TeamMember extends base_entity_1.BaseEntity {
    email;
    team_id;
    team;
    account_id;
    account;
    role;
    permissions;
    static _OPENAPI_METADATA_FACTORY() {
        return { email: { required: true, type: () => String }, team_id: { required: true, type: () => String }, team: { required: true, type: () => require("./team.entity").Team }, account_id: { required: true, type: () => String }, account: { required: true, type: () => require("./account.entity").Account }, role: { required: true, type: () => String }, permissions: { required: true, type: () => [String] } };
    }
};
exports.TeamMember = TeamMember;
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], TeamMember.prototype, "email", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], TeamMember.prototype, "team_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => team_entity_1.Team, (team) => team.members, { onDelete: 'CASCADE' }),
    __metadata("design:type", team_entity_1.Team)
], TeamMember.prototype, "team", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'uuid' }),
    __metadata("design:type", String)
], TeamMember.prototype, "account_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => account_entity_1.Account, (account) => account.teamMemberships, {
        onDelete: 'CASCADE',
    }),
    __metadata("design:type", account_entity_1.Account)
], TeamMember.prototype, "account", void 0);
__decorate([
    (0, typeorm_1.Column)({
        nullable: false,
        type: 'enum',
        enum: base_entity_1.RolesEnum,
        default: base_entity_1.RolesEnum.FACILITY_MANAGER,
    }),
    __metadata("design:type", String)
], TeamMember.prototype, "role", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', array: true, nullable: true }),
    __metadata("design:type", Array)
], TeamMember.prototype, "permissions", void 0);
exports.TeamMember = TeamMember = __decorate([
    (0, typeorm_1.Entity)()
], TeamMember);
//# sourceMappingURL=team-member.entity.js.map