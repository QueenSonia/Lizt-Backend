import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, Repository } from 'typeorm';
import { MaintenanceRequest } from 'src/maintenance-requests/entities/maintenance-request.entity';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMessage, MessageSender, MessageType } from './chat-message.entity';
import { UtilService } from 'src/utils/utility-service';
import { MaintenanceRequestsService } from 'src/maintenance-requests/maintenance-requests.service';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MaintenanceRequestStatusEnum } from 'src/maintenance-requests/dto/create-maintenance-request.dto';
import { TenantStatusEnum } from 'src/properties/dto/create-property.dto';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,
    @InjectRepository(MaintenanceRequest)
    private readonly maintenanceRequestRepo: Repository<MaintenanceRequest>,

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
        where: { tenant_id: userId, status: TenantStatusEnum.ACTIVE },
        relations: ['property', 'tenant'],
      });

      if (!propertyTenant) {
        throw new Error('Tenant not found');
      }

      const isMaintenanceRequestExists = await this.maintenanceRequestRepo.findOne({
        where: { request_id: sendMessageDto.requestId },
      });

      if (!isMaintenanceRequestExists) {
        // const requestId = UtilService.generateMaintenanceRequestId();
        // 1. Create and save the maintenance request
        const maintenanceRequest = this.maintenanceRequestRepo.create({
          tenant_id: userId,
          property_id: propertyTenant.property_id,
          tenant_name: propertyTenant.tenant.profile_name,
          property_name: propertyTenant.property.name,
          issue_category: 'service',
          date_reported: new Date(),
          description: sendMessageDto.content,
          request_id: sendMessageDto.requestId, // assuming requestId is passed in sendMessageDto
        });

        (await this.maintenanceRequestRepo.save(maintenanceRequest)) as any;

        this.eventEmitter.emit('maintenance.created', {
          user_id: userId,
          property_id: propertyTenant.property_id,
          landlord_id: propertyTenant.property?.owner_id,
          tenant_name: propertyTenant.tenant.profile_name,
          property_name: propertyTenant.property.name,
          maintenance_request_id: maintenanceRequest.id,
          description: sendMessageDto.content,
          created_at: maintenanceRequest.created_at,
        });
      }
    }

    // 2. Create and save the chat message
    const message = this.chatMessageRepository.create({
      ...sendMessageDto,
      maintenance_request_id: sendMessageDto.requestId, // assuming requestId is the primary key
    });

    return this.chatMessageRepository.save(message);
  }

  async getAllMessagesForUser(
    currentUser: 'admin' | 'tenant' | 'rep',
  ): Promise<any[]> {
    const normalizedUser = currentUser === 'rep' ? 'admin' : currentUser;

    return (
      this.chatMessageRepository
        .createQueryBuilder('message')
        .select('message.maintenance_request_id', 'requestId')
        .addSelect('MAX(message.created_at)', 'lastMessageAt')
        .addSelect('COUNT(*)', 'messageCount')

        // 🔥 Count unread messages not sent by the current user (i.e., incoming)
        .addSelect(
          `COUNT(CASE 
         WHEN message.isRead = false 
         AND message.sender != :normalizedUser 
         THEN 1 
       END)`,
          'unread',
        )

        .leftJoin('message.maintenanceRequest', 'maintenanceRequest')
        .addSelect('maintenanceRequest.tenant_name', 'tenant_name')
        .addSelect('maintenanceRequest.issue_category', 'issue_category')
        .addSelect('maintenanceRequest.description', 'description')
        .addSelect('maintenanceRequest.status', 'status')

        .groupBy('message.maintenance_request_id')
        .addGroupBy('maintenanceRequest.tenant_name')
        .addGroupBy('maintenanceRequest.issue_category')
        .addGroupBy('maintenanceRequest.description')
        .addGroupBy('maintenanceRequest.status')
        .orderBy('MAX(message.created_at)', 'DESC')
        .setParameter('normalizedUser', normalizedUser)
        .getRawMany()
    );
  }

  async getMessagesByRequestId(requestId: string): Promise<ChatMessage[]> {
    console.log('Fetching messages for requestId:', requestId);
    return this.chatMessageRepository.find({
      where: { maintenance_request_id: requestId },
      relations: ['maintenanceRequest', 'maintenanceRequest.tenant.user'],
      order: { created_at: 'ASC' },
    });
  }

  async markMessagesAsRead(
    requestId: string,
    sender: MessageSender,
  ): Promise<void> {
    await this.chatMessageRepository.update(
      {
        maintenance_request_id: requestId,
        sender: Not(sender),
        isRead: false,
      },
      { isRead: true },
    );
  }

  async markAsResolved(requestId: string) {
    await this.maintenanceRequestRepo.update(
      {
        request_id: requestId,
      },
      {
        status: MaintenanceRequestStatusEnum.RESOLVED,
      },
    );
  }

  async createSystemMessage(data: {
    maintenanceRequestId: string;
    content: string;
  }): Promise<ChatMessage> {
    return this.chatMessageRepository.save({
      maintenanceRequest: { id: data.maintenanceRequestId },
      sender: MessageSender.SYSTEM,
      type: MessageType.SYSTEM,
      content: data.content,
      senderName: 'System',
    });
  }
}
