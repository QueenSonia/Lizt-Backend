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
exports.AutoServiceRequest = exports.ServiceRequestSource = exports.ServiceRequestPriority = exports.ServiceRequestStatus = void 0;
const openapi = require("@nestjs/swagger");
const property_tenants_entity_1 = require("../../properties/entities/property-tenants.entity");
const typeorm_1 = require("typeorm");
var ServiceRequestStatus;
(function (ServiceRequestStatus) {
    ServiceRequestStatus["OPEN"] = "open";
    ServiceRequestStatus["IN_PROGRESS"] = "in_progress";
    ServiceRequestStatus["PENDING"] = "pending";
    ServiceRequestStatus["RESOLVED"] = "resolved";
    ServiceRequestStatus["CLOSED"] = "closed";
    ServiceRequestStatus["CANCELLED"] = "cancelled";
})(ServiceRequestStatus || (exports.ServiceRequestStatus = ServiceRequestStatus = {}));
var ServiceRequestPriority;
(function (ServiceRequestPriority) {
    ServiceRequestPriority["LOW"] = "low";
    ServiceRequestPriority["MEDIUM"] = "medium";
    ServiceRequestPriority["HIGH"] = "high";
    ServiceRequestPriority["URGENT"] = "urgent";
})(ServiceRequestPriority || (exports.ServiceRequestPriority = ServiceRequestPriority = {}));
var ServiceRequestSource;
(function (ServiceRequestSource) {
    ServiceRequestSource["TAWK_CHAT"] = "tawk_chat";
    ServiceRequestSource["EMAIL"] = "email";
    ServiceRequestSource["PHONE"] = "phone";
    ServiceRequestSource["PORTAL"] = "portal";
    ServiceRequestSource["MANUAL"] = "manual";
})(ServiceRequestSource || (exports.ServiceRequestSource = ServiceRequestSource = {}));
let AutoServiceRequest = class AutoServiceRequest {
    id;
    title;
    description;
    status;
    priority;
    source;
    externalId;
    customerName;
    customerEmail;
    customerPhone;
    customerLocation;
    assignedTo;
    assignedAt;
    resolvedAt;
    resolutionNotes;
    metadata;
    internalNotes;
    tags;
    dueDate;
    propertyTenant;
    createdAt;
    updatedAt;
    get isOverdue() {
        return (this.dueDate &&
            this.dueDate < new Date() &&
            this.status !== ServiceRequestStatus.CLOSED);
    }
    get ageInDays() {
        const now = new Date();
        const created = new Date(this.createdAt);
        return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
    }
    markAsResolved(resolutionNotes) {
        this.status = ServiceRequestStatus.RESOLVED;
        this.resolvedAt = new Date();
        if (resolutionNotes) {
            this.resolutionNotes = resolutionNotes;
        }
    }
    assignTo(assignee) {
        this.assignedTo = assignee;
        this.assignedAt = new Date();
        if (this.status === ServiceRequestStatus.OPEN) {
            this.status = ServiceRequestStatus.IN_PROGRESS;
        }
    }
    addTag(tag) {
        if (!this.tags) {
            this.tags = [];
        }
        if (!this.tags.includes(tag)) {
            this.tags.push(tag);
        }
    }
    removeTag(tag) {
        if (this.tags) {
            this.tags = this.tags.filter((t) => t !== tag);
        }
    }
    updateTawkMetadata(updates) {
        if (this.source === ServiceRequestSource.TAWK_CHAT) {
            this.metadata = {
                ...(this.metadata || {}),
                ...updates,
            };
        }
    }
    static _OPENAPI_METADATA_FACTORY() {
        return { id: { required: true, type: () => String }, title: { required: true, type: () => String }, description: { required: true, type: () => String }, status: { required: true, enum: require("./auto-service-request.entity").ServiceRequestStatus }, priority: { required: true, enum: require("./auto-service-request.entity").ServiceRequestPriority }, source: { required: true, enum: require("./auto-service-request.entity").ServiceRequestSource }, externalId: { required: true, type: () => String }, customerName: { required: true, type: () => String }, customerEmail: { required: true, type: () => String }, customerPhone: { required: false, type: () => String }, customerLocation: { required: false, type: () => String }, assignedTo: { required: false, type: () => String }, assignedAt: { required: false, type: () => Date }, resolvedAt: { required: false, type: () => Date }, resolutionNotes: { required: false, type: () => String }, metadata: { required: false, type: () => Object }, internalNotes: { required: false, type: () => String }, tags: { required: false, type: () => [String] }, dueDate: { required: false, type: () => Date }, propertyTenant: { required: true, type: () => require("../../properties/entities/property-tenants.entity").PropertyTenant }, createdAt: { required: true, type: () => Date }, updatedAt: { required: true, type: () => Date } };
    }
};
exports.AutoServiceRequest = AutoServiceRequest;
__decorate([
    (0, typeorm_1.PrimaryGeneratedColumn)('uuid'),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "id", void 0);
__decorate([
    (0, typeorm_1.Column)({ length: 255 }),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "title", void 0);
__decorate([
    (0, typeorm_1.Column)('text'),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "description", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ServiceRequestStatus,
        default: ServiceRequestStatus.OPEN,
    }),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "status", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ServiceRequestPriority,
        default: ServiceRequestPriority.MEDIUM,
    }),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "priority", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: ServiceRequestSource,
    }),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "source", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'external_id', nullable: true, length: 255 }),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "externalId", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'customer_name', length: 255 }),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "customerName", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'customer_email', length: 255 }),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "customerEmail", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'customer_phone', nullable: true, length: 50 }),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "customerPhone", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'customer_location', nullable: true, length: 255 }),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "customerLocation", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'assigned_to', nullable: true, length: 255 }),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "assignedTo", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'assigned_at', nullable: true, type: 'timestamp' }),
    __metadata("design:type", Date)
], AutoServiceRequest.prototype, "assignedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'resolved_at', nullable: true, type: 'timestamp' }),
    __metadata("design:type", Date)
], AutoServiceRequest.prototype, "resolvedAt", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'resolution_notes', nullable: true, type: 'text' }),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "resolutionNotes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'jsonb', nullable: true }),
    __metadata("design:type", Object)
], AutoServiceRequest.prototype, "metadata", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'internal_notes', nullable: true, type: 'text' }),
    __metadata("design:type", String)
], AutoServiceRequest.prototype, "internalNotes", void 0);
__decorate([
    (0, typeorm_1.Column)({ type: 'simple-array', nullable: true }),
    __metadata("design:type", Array)
], AutoServiceRequest.prototype, "tags", void 0);
__decorate([
    (0, typeorm_1.Column)({ name: 'due_date', nullable: true, type: 'timestamp' }),
    __metadata("design:type", Date)
], AutoServiceRequest.prototype, "dueDate", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => property_tenants_entity_1.PropertyTenant, { eager: true }),
    (0, typeorm_1.JoinColumn)({ name: 'property_tenant_id' }),
    __metadata("design:type", property_tenants_entity_1.PropertyTenant)
], AutoServiceRequest.prototype, "propertyTenant", void 0);
__decorate([
    (0, typeorm_1.CreateDateColumn)({ name: 'created_at' }),
    __metadata("design:type", Date)
], AutoServiceRequest.prototype, "createdAt", void 0);
__decorate([
    (0, typeorm_1.UpdateDateColumn)({ name: 'updated_at' }),
    __metadata("design:type", Date)
], AutoServiceRequest.prototype, "updatedAt", void 0);
exports.AutoServiceRequest = AutoServiceRequest = __decorate([
    (0, typeorm_1.Entity)('auto_service_requests'),
    (0, typeorm_1.Index)(['propertyTenant', 'status']),
    (0, typeorm_1.Index)(['source', 'createdAt']),
    (0, typeorm_1.Index)(['externalId', 'source'], { unique: true })
], AutoServiceRequest);
//# sourceMappingURL=auto-service-request.entity.js.map