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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_1 = require("@nestjs/typeorm");
const typeorm_2 = require("typeorm");
const service_request_entity_1 = require("../service-requests/entities/service-request.entity");
const chat_message_entity_1 = require("./chat-message.entity");
const property_tenants_entity_1 = require("../properties/entities/property-tenants.entity");
const event_emitter_1 = require("@nestjs/event-emitter");
const create_service_request_dto_1 = require("../service-requests/dto/create-service-request.dto");
let ChatService = class ChatService {
    chatMessageRepository;
    serviceRequestRepo;
    propertyTenantRepo;
    eventEmitter;
    constructor(chatMessageRepository, serviceRequestRepo, propertyTenantRepo, eventEmitter) {
        this.chatMessageRepository = chatMessageRepository;
        this.serviceRequestRepo = serviceRequestRepo;
        this.propertyTenantRepo = propertyTenantRepo;
        this.eventEmitter = eventEmitter;
    }
    async sendMessage(userId, sendMessageDto) {
        if (sendMessageDto.sender === chat_message_entity_1.MessageSender.TENANT) {
            const propertyTenant = await this.propertyTenantRepo.findOne({
                where: { tenant_id: userId },
                relations: ['property', 'tenant'],
            });
            if (!propertyTenant) {
                throw new Error('Tenant not found');
            }
            const isServiceRequestExists = await this.serviceRequestRepo.findOne({
                where: { request_id: sendMessageDto.requestId },
            });
            if (!isServiceRequestExists) {
                const serviceRequest = this.serviceRequestRepo.create({
                    tenant_id: userId,
                    property_id: propertyTenant.property_id,
                    tenant_name: propertyTenant.tenant.profile_name,
                    property_name: propertyTenant.property.name,
                    issue_category: 'service',
                    date_reported: new Date(),
                    description: sendMessageDto.content,
                    request_id: sendMessageDto.requestId,
                });
                (await this.serviceRequestRepo.save(serviceRequest));
                this.eventEmitter.emit('service.created', {
                    user_id: userId,
                    property_id: propertyTenant.property_id,
                    tenant_name: propertyTenant.tenant.profile_name,
                    property_name: propertyTenant.property.name,
                    service_request_id: serviceRequest.id
                });
            }
        }
        const message = this.chatMessageRepository.create({
            ...sendMessageDto,
            service_request_id: sendMessageDto.requestId,
        });
        return this.chatMessageRepository.save(message);
    }
    async getAllMessagesForUser(currentUser) {
        const normalizedUser = currentUser === 'rep' ? 'admin' : currentUser;
        return this.chatMessageRepository
            .createQueryBuilder('message')
            .select('message.service_request_id', 'requestId')
            .addSelect('MAX(message.created_at)', 'lastMessageAt')
            .addSelect('COUNT(*)', 'messageCount')
            .addSelect(`COUNT(CASE 
         WHEN message.isRead = false 
         AND message.sender != :normalizedUser 
         THEN 1 
       END)`, 'unread')
            .leftJoin('message.serviceRequest', 'serviceRequest')
            .addSelect('serviceRequest.tenant_name', 'tenant_name')
            .addSelect('serviceRequest.issue_category', 'issue_category')
            .addSelect('serviceRequest.description', 'description')
            .addSelect('serviceRequest.status', 'status')
            .groupBy('message.service_request_id')
            .addGroupBy('serviceRequest.tenant_name')
            .addGroupBy('serviceRequest.issue_category')
            .addGroupBy('serviceRequest.description')
            .addGroupBy('serviceRequest.status')
            .orderBy('MAX(message.created_at)', 'DESC')
            .setParameter('normalizedUser', normalizedUser)
            .getRawMany();
    }
    async getMessagesByRequestId(requestId) {
        console.log('Fetching messages for requestId:', requestId);
        return this.chatMessageRepository.find({
            where: { service_request_id: requestId },
            relations: ['serviceRequest', 'serviceRequest.tenant.user'],
            order: { created_at: 'ASC' },
        });
    }
    async markMessagesAsRead(requestId, sender) {
        await this.chatMessageRepository.update({
            service_request_id: requestId,
            sender: (0, typeorm_2.Not)(sender),
            isRead: false,
        }, { isRead: true });
    }
    async markAsResolved(requestId) {
        await this.serviceRequestRepo.update({
            request_id: requestId
        }, {
            status: create_service_request_dto_1.ServiceRequestStatusEnum.RESOLVED
        });
    }
    async createSystemMessage(data) {
        return this.chatMessageRepository.save({
            serviceRequest: { id: data.serviceRequestId },
            sender: chat_message_entity_1.MessageSender.SYSTEM,
            type: chat_message_entity_1.MessageType.SYSTEM,
            content: data.content,
            senderName: 'System',
        });
    }
};
exports.ChatService = ChatService;
exports.ChatService = ChatService = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, typeorm_1.InjectRepository)(chat_message_entity_1.ChatMessage)),
    __param(1, (0, typeorm_1.InjectRepository)(service_request_entity_1.ServiceRequest)),
    __param(2, (0, typeorm_1.InjectRepository)(property_tenants_entity_1.PropertyTenant)),
    __metadata("design:paramtypes", [typeorm_2.Repository,
        typeorm_2.Repository,
        typeorm_2.Repository,
        event_emitter_1.EventEmitter2])
], ChatService);
//# sourceMappingURL=chat.service.js.map