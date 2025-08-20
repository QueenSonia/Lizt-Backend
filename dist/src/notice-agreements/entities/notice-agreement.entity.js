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
exports.NoticeAgreement = exports.NoticeType = exports.SendVia = exports.NoticeStatus = void 0;
const openapi = require("@nestjs/swagger");
const base_entity_1 = require("../../base.entity");
const property_entity_1 = require("../../properties/entities/property.entity");
const account_entity_1 = require("../../users/entities/account.entity");
const typeorm_1 = require("typeorm");
var NoticeStatus;
(function (NoticeStatus) {
    NoticeStatus["ACKNOWLEDGED"] = "acknowledged";
    NoticeStatus["NOT_ACKNOWLEDGED"] = "not_acknowledged";
    NoticeStatus["PENDING"] = "pending";
})(NoticeStatus || (exports.NoticeStatus = NoticeStatus = {}));
var SendVia;
(function (SendVia) {
    SendVia["EMAIL"] = "email";
    SendVia["WHATSAPP"] = "whatsapp";
})(SendVia || (exports.SendVia = SendVia = {}));
var NoticeType;
(function (NoticeType) {
    NoticeType["UPLOAD"] = "uploaded_document";
    NoticeType["RENT_INCREASE"] = "rent_increase";
    NoticeType["LEASE_RENEWAL"] = "lease_renewal";
    NoticeType["EVICTION"] = "eviction";
    NoticeType["WARNING"] = "warning";
})(NoticeType || (exports.NoticeType = NoticeType = {}));
let NoticeAgreement = class NoticeAgreement extends base_entity_1.BaseEntity {
    notice_id;
    notice_type;
    tenant_name;
    property_name;
    effective_date;
    notice_image;
    notice_documents;
    status;
    send_via;
    additional_notes;
    property_id;
    tenant_id;
    property;
    tenant;
    static _OPENAPI_METADATA_FACTORY() {
        return { notice_id: { required: true, type: () => String }, notice_type: { required: true, enum: require("./notice-agreement.entity").NoticeType }, tenant_name: { required: true, type: () => String }, property_name: { required: true, type: () => String }, effective_date: { required: true, type: () => Date }, notice_image: { required: false, type: () => String, nullable: true }, notice_documents: { required: true, type: () => [({ url: { required: true, type: () => String }, name: { required: false, type: () => String }, type: { required: false, type: () => String } })] }, status: { required: true, enum: require("./notice-agreement.entity").NoticeStatus }, send_via: { required: true, enum: require("./notice-agreement.entity").SendVia, isArray: true }, additional_notes: { required: false, type: () => String, nullable: true }, property_id: { required: true, type: () => String }, tenant_id: { required: true, type: () => String }, property: { required: true, type: () => require("../../properties/entities/property.entity").Property }, tenant: { required: true, type: () => require("../../users/entities/account.entity").Account } };
    }
};
exports.NoticeAgreement = NoticeAgreement;
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', unique: true }),
    __metadata("design:type", String)
], NoticeAgreement.prototype, "notice_id", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: NoticeType,
    }),
    __metadata("design:type", String)
], NoticeAgreement.prototype, "notice_type", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], NoticeAgreement.prototype, "tenant_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar' }),
    __metadata("design:type", String)
], NoticeAgreement.prototype, "property_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'timestamp' }),
    __metadata("design:type", Date)
], NoticeAgreement.prototype, "effective_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'varchar', nullable: true }),
    __metadata("design:type", Object)
], NoticeAgreement.prototype, "notice_image", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true, default: [] }),
    __metadata("design:type", Array)
], NoticeAgreement.prototype, "notice_documents", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: NoticeStatus,
        default: NoticeStatus.PENDING,
    }),
    __metadata("design:type", String)
], NoticeAgreement.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: SendVia,
        array: true,
        default: [SendVia.EMAIL],
    }),
    __metadata("design:type", Array)
], NoticeAgreement.prototype, "send_via", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'text', nullable: true }),
    __metadata("design:type", Object)
], NoticeAgreement.prototype, "additional_notes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", String)
], NoticeAgreement.prototype, "property_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", String)
], NoticeAgreement.prototype, "tenant_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => property_entity_1.Property, (p) => p.notice_agreements),
    (0, typeorm_1.JoinColumn)({ name: 'property_id', referencedColumnName: 'id' }),
    __metadata("design:type", property_entity_1.Property)
], NoticeAgreement.prototype, "property", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => account_entity_1.Account, (u) => u.notice_agreements),
    (0, typeorm_1.JoinColumn)({ name: 'tenant_id', referencedColumnName: 'id' }),
    __metadata("design:type", account_entity_1.Account)
], NoticeAgreement.prototype, "tenant", void 0);
exports.NoticeAgreement = NoticeAgreement = __decorate([
    (0, typeorm_1.Entity)({ name: 'notice_agreement' })
], NoticeAgreement);
//# sourceMappingURL=notice-agreement.entity.js.map