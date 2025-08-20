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
exports.ServiceRequestListener = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const notification_service_1 = require("../notification.service");
const notification_type_1 = require("../enums/notification-type");
let ServiceRequestListener = class ServiceRequestListener {
    notificationService;
    constructor(notificationService) {
        this.notificationService = notificationService;
    }
    handle(event) {
        this.notificationService.create({
            date: new Date().toISOString(),
            type: notification_type_1.NotificationType.SERVICE_REQUEST,
            description: `${event.tenant_name} made a service request for ${event.property_name}.`,
            status: 'Pending',
            property_id: event.property_id,
            user_id: event.user_id,
            service_request_id: event.service_request_id
        });
    }
};
exports.ServiceRequestListener = ServiceRequestListener;
__decorate([
    (0, event_emitter_1.OnEvent)('service.created'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ServiceRequestListener.prototype, "handle", null);
exports.ServiceRequestListener = ServiceRequestListener = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [notification_service_1.NotificationService])
], ServiceRequestListener);
//# sourceMappingURL=service-request.listener.js.map