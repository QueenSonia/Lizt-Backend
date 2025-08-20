"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateNotificationDto = void 0;
const openapi = require("@nestjs/swagger");
class CreateNotificationDto {
    date;
    type;
    description;
    status;
    property_id;
    user_id;
    service_request_id;
    static _OPENAPI_METADATA_FACTORY() {
        return { date: { required: true, type: () => String }, type: { required: true, enum: require("../enums/notification-type").NotificationType }, description: { required: true, type: () => String }, status: { required: true, type: () => Object }, property_id: { required: true, type: () => String }, user_id: { required: true, type: () => String }, service_request_id: { required: false, type: () => String } };
    }
}
exports.CreateNotificationDto = CreateNotificationDto;
//# sourceMappingURL=create-notification.dto.js.map