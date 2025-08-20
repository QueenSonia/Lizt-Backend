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
exports.Notification = void 0;
const openapi = require("@nestjs/swagger");
const typeorm_1 = require("typeorm");
const notification_type_1 = require("../enums/notification-type");
const account_entity_1 = require("../../users/entities/account.entity");
const property_entity_1 = require("../../properties/entities/property.entity");
const base_entity_1 = require("../../base.entity");
const service_request_entity_1 = require("../../service-requests/entities/service-request.entity");
let Notification = class Notification extends base_entity_1.BaseEntity {
    date;
    type;
    description;
    status;
    property_id;
    user_id;
    service_request_id;
    property;
    user;
    serviceRequest;
    static _OPENAPI_METADATA_FACTORY() {
        return { date: { required: true, type: () => String }, type: { required: true, enum: require("../enums/notification-type").NotificationType }, description: { required: true, type: () => String }, status: { required: true, type: () => Object }, property_id: { required: true, type: () => String }, user_id: { required: true, type: () => String }, service_request_id: { required: true, type: () => String }, property: { required: true, type: () => require("../../properties/entities/property.entity").Property }, user: { required: true, type: () => require("../../users/entities/account.entity").Account }, serviceRequest: { required: true, type: () => require("../../service-requests/entities/service-request.entity").ServiceRequest } };
    }
};
exports.Notification = Notification;
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Notification.prototype, "date", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'enum', enum: notification_type_1.NotificationType }),
    __metadata("design:type", String)
], Notification.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], Notification.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: 'Pending' }),
    __metadata("design:type", String)
], Notification.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: false }),
    __metadata("design:type", String)
], Notification.prototype, "property_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: false }),
    __metadata("design:type", String)
], Notification.prototype, "user_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'uuid', nullable: true }),
    __metadata("design:type", String)
], Notification.prototype, "service_request_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => property_entity_1.Property, (property) => property.notification, {
        onDelete: 'CASCADE',
    }),
    (0, typeorm_1.JoinColumn)({ name: 'property_id', referencedColumnName: 'id' }),
    __metadata("design:type", property_entity_1.Property)
], Notification.prototype, "property", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => account_entity_1.Account, (user) => user.notification),
    (0, typeorm_1.JoinColumn)({ name: 'user_id', referencedColumnName: 'id' }),
    __metadata("design:type", account_entity_1.Account)
], Notification.prototype, "user", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => service_request_entity_1.ServiceRequest, (request) => request.notification, {
        onDelete: 'CASCADE',
    }),
    (0, typeorm_1.JoinColumn)({ name: 'service_request_id', referencedColumnName: 'id' }),
    __metadata("design:type", service_request_entity_1.ServiceRequest)
], Notification.prototype, "serviceRequest", void 0);
exports.Notification = Notification = __decorate([
    (0, typeorm_1.Entity)()
], Notification);
//# sourceMappingURL=notification.entity.js.map