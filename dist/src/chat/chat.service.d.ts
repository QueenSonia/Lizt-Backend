import { Repository } from 'typeorm';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMessage, MessageSender } from './chat-message.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
export declare class ChatService {
    private readonly chatMessageRepository;
    private readonly serviceRequestRepo;
    private readonly propertyTenantRepo;
    private readonly eventEmitter;
    constructor(chatMessageRepository: Repository<ChatMessage>, serviceRequestRepo: Repository<ServiceRequest>, propertyTenantRepo: Repository<PropertyTenant>, eventEmitter: EventEmitter2);
    sendMessage(userId: string, sendMessageDto: SendMessageDto): Promise<ChatMessage>;
    getAllMessagesForUser(currentUser: 'admin' | 'tenant' | 'rep'): Promise<any[]>;
    getMessagesByRequestId(requestId: string): Promise<ChatMessage[]>;
    markMessagesAsRead(requestId: string, sender: MessageSender): Promise<void>;
    markAsResolved(requestId: string): Promise<void>;
    createSystemMessage(data: {
        serviceRequestId: string;
        content: string;
    }): Promise<ChatMessage>;
}
