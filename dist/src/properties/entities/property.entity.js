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
exports.Property = void 0;
const openapi = require("@nestjs/swagger");
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../base.entity");
const create_property_dto_1 = require("../dto/create-property.dto");
const rent_entity_1 = require("../../rents/entities/rent.entity");
const property_tenants_entity_1 = require("./property-tenants.entity");
const service_request_entity_1 = require("../../service-requests/entities/service-request.entity");
const property_history_entity_1 = require("../../property-history/entities/property-history.entity");
const rent_increase_entity_1 = require("../../rents/entities/rent-increase.entity");
const notice_agreement_entity_1 = require("../../notice-agreements/entities/notice-agreement.entity");
const account_entity_1 = require("../../users/entities/account.entity");
const notification_entity_1 = require("../../notifications/entities/notification.entity");
let Property = class Property extends base_entity_1.BaseEntity {
    name;
    location;
    description;
    property_status;
    owner_id;
    property_type;
    property_images;
    no_of_bedrooms;
    rental_price;
    payment_frequency;
    security_deposit;
    service_charge;
    comment;
    property_tenants;
    owner;
    rents;
    service_requests;
    property_histories;
    rent_increases;
    notice_agreements;
    notification;
    static _OPENAPI_METADATA_FACTORY() {
        return { name: { required: true, type: () => String }, location: { required: true, type: () => String }, description: { required: true, type: () => String }, property_status: { required: true, type: () => String }, owner_id: { required: true, type: () => String }, property_type: { required: true, type: () => String }, property_images: { required: true, type: () => [String] }, no_of_bedrooms: { required: true, type: () => Number }, rental_price: { required: true, type: () => Number }, payment_frequency: { required: true, type: () => String }, security_deposit: { required: true, type: () => Number }, service_charge: { required: true, type: () => Number }, comment: { required: false, type: () => String, nullable: true }, property_tenants: { required: true, type: () => [require("./property-tenants.entity").PropertyTenant] }, owner: { required: true, type: () => require("../../users/entities/account.entity").Account }, rents: { required: true, type: () => [require("../../rents/entities/rent.entity").Rent] }, service_requests: { required: true, type: () => [require("../../service-requests/entities/service-request.entity").ServiceRequest] }, property_histories: { required: true, type: () => [require("../../property-history/entities/property-history.entity").PropertyHistory] }, rent_increases: { required: true, type: () => [require("../../rents/entities/rent-increase.entity").RentIncrease] }, notice_agreements: { required: true, type: () => [require("../../notice-agreements/entities/notice-agreement.entity").NoticeAgreement] }, notification: { required: true, type: () => [require("../../notifications/entities/notification.entity").Notification] } };
    }
};
exports.Property = Property;
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], Property.prototype, "name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], Property.prototype, "location", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Property.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({
        nullable: false,
        type: 'enum',
        enum: [create_property_dto_1.PropertyStatusEnum.NOT_VACANT, create_property_dto_1.PropertyStatusEnum.VACANT],
        default: create_property_dto_1.PropertyStatusEnum.VACANT,
    }),
    __metadata("design:type", String)
], Property.prototype, "property_status", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], Property.prototype, "owner_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], Property.prototype, "property_type", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar', array: true }),
    __metadata("design:type", Array)
], Property.prototype, "property_images", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'int' }),
    __metadata("design:type", Number)
], Property.prototype, "no_of_bedrooms", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Property.prototype, "rental_price", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar' }),
    __metadata("design:type", String)
], Property.prototype, "payment_frequency", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Property.prototype, "security_deposit", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'int', nullable: true }),
    __metadata("design:type", Number)
], Property.prototype, "service_charge", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'text' }),
    __metadata("design:type", Object)
], Property.prototype, "comment", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => property_tenants_entity_1.PropertyTenant, (t) => t.property),
    __metadata("design:type", Array)
], Property.prototype, "property_tenants", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => account_entity_1.Account, (owner) => owner.properties),
    (0, typeorm_1.JoinColumn)({ name: 'owner_id', referencedColumnName: 'id' }),
    __metadata("design:type", account_entity_1.Account)
], Property.prototype, "owner", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => rent_entity_1.Rent, (r) => r.property),
    __metadata("design:type", Array)
], Property.prototype, "rents", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => service_request_entity_1.ServiceRequest, (sr) => sr.property),
    __metadata("design:type", Array)
], Property.prototype, "service_requests", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => property_history_entity_1.PropertyHistory, (ph) => ph.property),
    __metadata("design:type", Array)
], Property.prototype, "property_histories", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => rent_increase_entity_1.RentIncrease, (ri) => ri.property),
    __metadata("design:type", Array)
], Property.prototype, "rent_increases", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => notice_agreement_entity_1.NoticeAgreement, (na) => na.property),
    __metadata("design:type", Array)
], Property.prototype, "notice_agreements", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => notification_entity_1.Notification, (no) => no.property),
    __metadata("design:type", Array)
], Property.prototype, "notification", void 0);
exports.Property = Property = __decorate([
    (0, typeorm_1.Entity)({ name: 'properties' })
], Property);
//# sourceMappingURL=property.entity.js.map