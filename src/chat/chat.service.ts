import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMessage, MessageSender, MessageType } from './chat-message.entity';


@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatMessage)
    private readonly chatMessageRepository: Repository<ChatMessage>,

    @InjectRepository(ServiceRequest)
    private readonly serviceRequestRepo: Repository<ServiceRequest>
  ) {}

  async saveMessage(payload: SendMessageDto): Promise<ChatMessage> {
    const serviceRequest = await this.serviceRequestRepo.findOne({
      where: { request_id: payload.serviceRequestId },
    }) as any

    const message = this.chatMessageRepository.create({
      ...payload,
      serviceRequest,
    });

    return await this.chatMessageRepository.save(message);
  }

   async sendMessage(sendMessageDto: SendMessageDto): Promise<ChatMessage> {
    const message = this.chatMessageRepository.create(sendMessageDto);
    return this.chatMessageRepository.save(message);
  }

  async getMessagesByRequestId(requestId: string): Promise<ChatMessage[]> {
    return this.chatMessageRepository.find({
      where: { serviceRequestId: requestId },
      order: { createdAt: 'ASC' }
    });
  }

  async markMessagesAsRead(requestId: string, sender: MessageSender): Promise<void> {
    await this.chatMessageRepository.update(
      {
        serviceRequestId: requestId,
        sender,
        isRead: false
      },
      { isRead: true }
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
