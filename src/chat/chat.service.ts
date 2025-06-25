import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMessage, MessageSender, MessageType } from './chat-message.entity';
import { UtilService } from 'src/utils/utility-service';
import { ServiceRequestsService } from 'src/service-requests/service-requests.service';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepo: Repository<ServiceRequest>,

    @InjectRepository(PropertyTenant)
    private readonly propertyTenantRepo: Repository<PropertyTenant>,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async sendMessage(
    userId: string,
    sendMessageDto: SendMessageDto,
  ): Promise<ChatMessage> {
    if (sendMessageDto.sender === MessageSender.TENANT) {
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
        // const requestId = UtilService.generateServiceRequestId();
        // 1. Create and save the service request
        const serviceRequest = this.serviceRequestRepo.create({
          tenant_id: userId,
          property_id: propertyTenant.property_id,
          tenant_name: propertyTenant.tenant.profile_name,
          property_name: propertyTenant.property.name,
          issue_category: 'service',
          date_reported: new Date(),
          description: sendMessageDto.content,
          request_id: sendMessageDto.requestId, // assuming requestId is passed in sendMessageDto
        });

        (await this.serviceRequestRepo.save(serviceRequest)) as any;

        this.eventEmitter.emit('service.created', {
          user_id: userId,
          property_id: propertyTenant.property_id,
          tenant_name: propertyTenant.tenant.profile_name,
          property_name: propertyTenant.property.name,
        });
      }
    }

    // 2. Create and save the chat message
    const message = this.chatMessageRepository.create({
      ...sendMessageDto,
      service_request_id: sendMessageDto.requestId, // assuming requestId is the primary key
    });

    return this.chatMessageRepository.save(message);
  }

  async getAllMessages(): Promise<any[]> {
    return this.chatMessageRepository
      .createQueryBuilder('message')
      .select('message.service_request_id', 'requestId')
      .addSelect('MAX(message.created_at)', 'lastMessageAt')
      .addSelect('COUNT(*)', 'messageCount')
      .leftJoin('message.serviceRequest', 'serviceRequest')
      .addSelect('serviceRequest.tenant_name', 'tenant_name')
      .addSelect('serviceRequest.issue_category', 'issue_category')
      .addSelect('serviceRequest.description', 'description')
      .groupBy('message.service_request_id')
      .addGroupBy('serviceRequest.tenant_name')
      .addGroupBy('serviceRequest.issue_category')
      .addGroupBy('serviceRequest.description')
      .orderBy('MAX(message.created_at)', 'DESC') // ✅ correct
      .getRawMany();
  }

  async getMessagesByRequestId(requestId: string): Promise<ChatMessage[]> {
    console.log('Fetching messages for requestId:', requestId);
    return this.chatMessageRepository.find({
      where: { service_request_id: requestId },
      relations: ['serviceRequest', 'serviceRequest.tenant.user'],
      order: { created_at: 'ASC' },
    });
  }

  async markMessagesAsRead(
    requestId: string,
    sender: MessageSender,
  ): Promise<void> {
    await this.chatMessageRepository.update(
      {
        service_request_id: requestId,
        sender,
        isRead: false,
      },
      { isRead: true },
    );
  }

  async createSystemMessage(data: {
    serviceRequestId: string;
    content: string;
  }): Promise<ChatMessage> {
    return this.chatMessageRepository.save({
      serviceRequest: { id: data.serviceRequestId },
      sender: MessageSender.SYSTEM,
      type: MessageType.SYSTEM,
      content: data.content,
      senderName: 'System',
    });
  }
}
