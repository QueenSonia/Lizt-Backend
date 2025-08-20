"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SendMessageDto = void 0;
const openapi = require("@nestjs/swagger");
class SendMessageDto {
    requestId;
    sender;
    content;
    type;
    fileName;
    fileUrl;
    senderName;
    static _OPENAPI_METADATA_FACTORY() {
        return { requestId: { required: true, type: () => String }, sender: { required: true, enum: require("../chat-message.entity").MessageSender }, content: { required: true, type: () => String }, type: { required: false, enum: require("../chat-message.entity").MessageType }, fileName: { required: false, type: () => String }, fileUrl: { required: false, type: () => String }, senderName: { required: false, type: () => String } };
    }
}
exports.SendMessageDto = SendMessageDto;
//# sourceMappingURL=send-message.dto.js.map