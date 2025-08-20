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
exports.ServiceRequest = void 0;
const openapi = require("@nestjs/swagger");
const typeorm_1 = require("typeorm");
const base_entity_1 = require("../../base.entity");
const property_entity_1 = require("../../properties/entities/property.entity");
const create_service_request_dto_1 = require("../dto/create-service-request.dto");
const account_entity_1 = require("../../users/entities/account.entity");
const chat_message_entity_1 = require("../../chat/chat-message.entity");
const notification_entity_1 = require("../../notifications/entities/notification.entity");
let ServiceRequest = class ServiceRequest extends base_entity_1.BaseEntity {
    request_id;
    tenant_name;
    property_name;
    issue_category;
    date_reported;
    resolution_date;
    description;
    issue_images;
    resolvedAt;
    notes;
    status;
    tenant_id;
    property_id;
    tenant;
    property;
    messages;
    notification;
    static _OPENAPI_METADATA_FACTORY() {
        return { request_id: { required: true, type: () => String }, tenant_name: { required: true, type: () => String }, property_name: { required: true, type: () => String }, issue_category: { required: true, type: () => String }, date_reported: { required: true, type: () => Date }, resolution_date: { required: false, type: () => Date, nullable: true }, description: { required: true, type: () => String }, issue_images: { required: false, type: () => [String], nullable: true }, resolvedAt: { required: true, type: () => Date }, notes: { required: true, type: () => String }, status: { required: true, type: () => String, nullable: true }, tenant_id: { required: true, type: () => String }, property_id: { required: true, type: () => String }, tenant: { required: true, type: () => require("../../users/entities/account.entity").Account }, property: { required: true, type: () => require("../../properties/entities/property.entity").Property }, messages: { required: true, type: () => [require("../../chat/chat-message.entity").ChatMessage] }, notification: { required: true, type: () => require("../../notifications/entities/notification.entity").Notification } };
    }
};
exports.ServiceRequest = ServiceRequest;
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar', unique: true }),
    __metadata("design:type", String)
], ServiceRequest.prototype, "request_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], ServiceRequest.prototype, "tenant_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], ServiceRequest.prototype, "property_name", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'varchar' }),
    __metadata("design:type", String)
], ServiceRequest.prototype, "issue_category", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'timestamp' }),
    __metadata("design:type", Date)
], ServiceRequest.prototype, "date_reported", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'timestamp' }),
    __metadata("design:type", Object)
], ServiceRequest.prototype, "resolution_date", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'text' }),
    __metadata("design:type", String)
], ServiceRequest.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true, type: 'varchar', array: true }),
    __metadata("design:type", Object)
], ServiceRequest.prototype, "issue_images", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", Date)
], ServiceRequest.prototype, "resolvedAt", void 0);
__decorate([
    (0, typeorm_1.Column)('text', { nullable: true }),
    __metadata("design:type", String)
], ServiceRequest.prototype, "notes", void 0);
__decorate([
    (0, typeorm_1.Column)({
        nullable: false,
        type: 'enum',
        enum: [
            create_service_request_dto_1.ServiceRequestStatusEnum.PENDING,
            create_service_request_dto_1.ServiceRequestStatusEnum.IN_PROGRESS,
            create_service_request_dto_1.ServiceRequestStatusEnum.RESOLVED,
            create_service_request_dto_1.ServiceRequestStatusEnum.URGENT,
        ],
        default: create_service_request_dto_1.ServiceRequestStatusEnum.PENDING,
    }),
    __metadata("design:type", Object)
], ServiceRequest.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], ServiceRequest.prototype, "tenant_id", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: false, type: 'uuid' }),
    __metadata("design:type", String)
], ServiceRequest.prototype, "property_id", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => account_entity_1.Account, (u) => u.service_requests),
    (0, typeorm_1.JoinColumn)({ name: 'tenant_id', referencedColumnName: 'id' }),
    __metadata("design:type", account_entity_1.Account)
], ServiceRequest.prototype, "tenant", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => property_entity_1.Property, (p) => p.service_requests, {
        onDelete: 'CASCADE',
    }),
    (0, typeorm_1.JoinColumn)({ name: 'property_id', referencedColumnName: 'id' }),
    __metadata("design:type", property_entity_1.Property)
], ServiceRequest.prototype, "property", void 0);
__decorate([
    (0, typeorm_1.OneToMany)(() => chat_message_entity_1.ChatMessage, message => message.serviceRequest),
    __metadata("design:type", Array)
], ServiceRequest.prototype, "messages", void 0);
__decorate([
    (0, typeorm_1.OneToOne)(() => notification_entity_1.Notification, (notification) => notification.serviceRequest),
    __metadata("design:type", notification_entity_1.Notification)
], ServiceRequest.prototype, "notification", void 0);
exports.ServiceRequest = ServiceRequest = __decorate([
    (0, typeorm_1.Entity)({ name: 'service_requests' })
], ServiceRequest);
//# sourceMappingURL=service-request.entity.js.map