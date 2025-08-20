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
exports.SendMessageDto = void 0;
const openapi = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const chat_message_entity_1 = require("../../chat/chat-message.entity");
class SendMessageDto {
    serviceRequestId;
    sender;
    type;
    content;
    fileName;
    fileUrl;
    senderName;
    static _OPENAPI_METADATA_FACTORY() {
        return { serviceRequestId: { required: true, type: () => String }, sender: { required: true, enum: require("../../chat/chat-message.entity").MessageSender }, type: { required: false, enum: require("../../chat/chat-message.entity").MessageType }, content: { required: true, type: () => String }, fileName: { required: false, type: () => String }, fileUrl: { required: false, type: () => String }, senderName: { required: false, type: () => String } };
    }
}
exports.SendMessageDto = SendMessageDto;
__decorate([
    (0, class_validator_1.IsNumber)(),
    __metadata("design:type", String)
], SendMessageDto.prototype, "serviceRequestId", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(chat_message_entity_1.MessageSender),
    __metadata("design:type", String)
], SendMessageDto.prototype, "sender", void 0);
__decorate([
    (0, class_validator_1.IsEnum)(chat_message_entity_1.MessageType),
    (0, class_validator_1.IsOptional)(),
    __metadata("design:type", String)
], SendMessageDto.prototype, "type", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendMessageDto.prototype, "content", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendMessageDto.prototype, "fileName", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendMessageDto.prototype, "fileUrl", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], SendMessageDto.prototype, "senderName", void 0);
//# sourceMappingURL=send-message.dto.js.map