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
exports.NoticeAgreementListener = void 0;
const common_1 = require("@nestjs/common");
const event_emitter_1 = require("@nestjs/event-emitter");
const notification_service_1 = require("../notification.service");
const notification_type_1 = require("../enums/notification-type");
let NoticeAgreementListener = class NoticeAgreementListener {
    notificationService;
    constructor(notificationService) {
        this.notificationService = notificationService;
    }
    handle(event) {
        this.notificationService.create({
            date: new Date().toISOString(),
            type: notification_type_1.NotificationType.NOTICE_AGREEMENT,
            description: `You created a notice agreement for ${event.property_name}.`,
            status: 'Completed',
            property_id: event.property_id,
            user_id: event.user_id
        });
    }
};
exports.NoticeAgreementListener = NoticeAgreementListener;
__decorate([
    (0, event_emitter_1.OnEvent)('notice.created'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], NoticeAgreementListener.prototype, "handle", null);
exports.NoticeAgreementListener = NoticeAgreementListener = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [notification_service_1.NotificationService])
], NoticeAgreementListener);
//# sourceMappingURL=notice-agreement.listener.js.map