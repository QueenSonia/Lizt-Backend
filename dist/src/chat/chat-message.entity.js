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
exports.ChatMessage = exports.MessageType = exports.MessageSender = void 0;
const openapi = require("@nestjs/swagger");
const base_entity_1 = require("../base.entity");
const service_request_entity_1 = require("../service-requests/entities/service-request.entity");
const typeorm_1 = require("typeorm");
var MessageSender;
(function (MessageSender) {
    MessageSender["TENANT"] = "tenant";
    MessageSender["REP"] = "rep";
    MessageSender["SYSTEM"] = "system";
    MessageSender["ADMIN"] = "admin";
})(MessageSender || (exports.MessageSender = MessageSender = {}));
var MessageType;
(function (MessageType) {
    MessageType["TEXT"] = "text";
    MessageType["FILE"] = "file";
    MessageType["IMAGE"] = "image";
    MessageType["SYSTEM"] = "system";
})(MessageType || (exports.MessageType = MessageType = {}));
let ChatMessage = class ChatMessage extends base_entity_1.BaseEntity {
    service_request_id;
    sender;
    type;
    content;
    fileName;
    fileUrl;
    isRead;
    senderName;
    serviceRequest;
    static _OPENAPI_METADATA_FACTORY() {
        return { service_request_id: { required: true, type: () => String }, sender: { required: true, enum: require("./chat-message.entity").MessageSender }, type: { required: true, enum: require("./chat-message.entity").MessageType }, content: { required: true, type: () => String }, fileName: { required: true, type: () => String }, fileUrl: { required: true, type: () => String }, isRead: { required: true, type: () => Boolean }, senderName: { required: true, type: () => String }, serviceRequest: { required: true, type: () => require("../service-requests/entities/service-request.entity").ServiceRequest } };
    }
};
exports.ChatMessage = ChatMessage;
__decorate([
    (0, typeorm_1.Column)(),
    __metadata("design:type", String)
], ChatMessage.prototype, "service_request_id", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: MessageSender
    }),
    __metadata("design:type", String)
], ChatMessage.prototype, "sender", void 0);
__decorate([
    (0, typeorm_1.Column)({
        type: 'enum',
        enum: MessageType,
        default: MessageType.TEXT
    }),
    __metadata("design:type", String)
], ChatMessage.prototype, "type", void 0);
__decorate([
    (0, typeorm_1.Column)('text'),
    __metadata("design:type", String)
], ChatMessage.prototype, "content", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], ChatMessage.prototype, "fileName", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], ChatMessage.prototype, "fileUrl", void 0);
__decorate([
    (0, typeorm_1.Column)({ default: false }),
    __metadata("design:type", Boolean)
], ChatMessage.prototype, "isRead", void 0);
__decorate([
    (0, typeorm_1.Column)({ nullable: true }),
    __metadata("design:type", String)
], ChatMessage.prototype, "senderName", void 0);
__decorate([
    (0, typeorm_1.ManyToOne)(() => service_request_entity_1.ServiceRequest, serviceRequest => serviceRequest.messages, {
        onDelete: 'CASCADE',
    }),
    (0, typeorm_1.JoinColumn)({ name: 'service_request_id', referencedColumnName: 'request_id' }),
    __metadata("design:type", service_request_entity_1.ServiceRequest)
], ChatMessage.prototype, "serviceRequest", void 0);
exports.ChatMessage = ChatMessage = __decorate([
    (0, typeorm_1.Entity)('chat_messages')
], ChatMessage);
//# sourceMappingURL=chat-message.entity.js.map