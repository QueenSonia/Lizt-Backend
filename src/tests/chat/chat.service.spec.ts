import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, Not } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ChatService } from 'src/chat/chat.service';
import {
  ChatMessage,
  MessageSender,
  MessageType,
} from 'src/chat/chat-message.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { SendMessageDto } from 'src/chat/dto/send-message.dto';
import { ServiceRequestStatusEnum } from 'src/service-requests/dto/create-service-request.dto';

describe('ChatService', () => {
  let service: ChatService;
  let chatMessageRepository: Repository<ChatMessage>;
  let serviceRequestRepo: Repository<ServiceRequest>;
  let propertyTenantRepo: Repository<PropertyTenant>;
  let eventEmitter: EventEmitter2;

  const mockChatMessageRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockServiceRequestRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockPropertyTenantRepo = {
    findOne: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatService,
        {
          provide: getRepositoryToken(ChatMessage),
          useValue: mockChatMessageRepository,
        },
        {
          provide: getRepositoryToken(ServiceRequest),
          useValue: mockServiceRequestRepo,
        },
        {
          provide: getRepositoryToken(PropertyTenant),
          useValue: mockPropertyTenantRepo,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<ChatService>(ChatService);
    chatMessageRepository = module.get<Repository<ChatMessage>>(
      getRepositoryToken(ChatMessage),
    );
    serviceRequestRepo = module.get<Repository<ServiceRequest>>(
      getRepositoryToken(ServiceRequest),
    );
    propertyTenantRepo = module.get<Repository<PropertyTenant>>(
      getRepositoryToken(PropertyTenant),
    );
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('sendMessage', () => {
    const userId = 'user-123';
    const requestId = 'req-123';
    const sendMessageDto: SendMessageDto = {
      requestId,
      sender: MessageSender.TENANT,
      content: 'Test message',
      type: MessageType.TEXT,
      senderName: 'John Doe',
    };

    it('should create a new service request if tenant message and request does not exist', async () => {
      const mockPropertyTenant = {
        tenant_id: userId,
        property_id: 'prop-123',
        property: { name: 'Test Property' },
        tenant: { profile_name: 'John Doe' },
      };

      const mockServiceRequest = {
        id: 1,
        request_id: requestId,
        tenant_id: userId,
        property_id: 'prop-123',
      };

      const mockChatMessage = {
        id: 1,
        ...sendMessageDto,
        service_request_id: requestId,
      };

      mockPropertyTenantRepo.findOne.mockResolvedValue(mockPropertyTenant);
      mockServiceRequestRepo.findOne.mockResolvedValue(null);
      mockServiceRequestRepo.create.mockReturnValue(mockServiceRequest);
      mockServiceRequestRepo.save.mockResolvedValue(mockServiceRequest);
      mockChatMessageRepository.create.mockReturnValue(mockChatMessage);
      mockChatMessageRepository.save.mockResolvedValue(mockChatMessage);

      const result = await service.sendMessage(userId, sendMessageDto);

      expect(mockPropertyTenantRepo.findOne).toHaveBeenCalledWith({
        where: { tenant_id: userId },
        relations: ['property', 'tenant'],
      });
      expect(mockServiceRequestRepo.findOne).toHaveBeenCalledWith({
        where: { request_id: requestId },
      });
      expect(mockServiceRequestRepo.create).toHaveBeenCalled();
      expect(mockServiceRequestRepo.save).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('service.created', {
        user_id: userId,
        property_id: 'prop-123',
        tenant_name: 'John Doe',
        property_name: 'Test Property',
        service_request_id: 1,
      });
      expect(result).toEqual(mockChatMessage);
    });

    it('should not create a new service request if it already exists', async () => {
      const mockPropertyTenant = {
        tenant_id: userId,
        property_id: 'prop-123',
        property: { name: 'Test Property' },
        tenant: { profile_name: 'John Doe' },
      };

      const mockExistingServiceRequest = {
        id: 1,
        request_id: requestId,
      };

      const mockChatMessage = {
        id: 1,
        ...sendMessageDto,
        service_request_id: requestId,
      };

      mockPropertyTenantRepo.findOne.mockResolvedValue(mockPropertyTenant);
      mockServiceRequestRepo.findOne.mockResolvedValue(
        mockExistingServiceRequest,
      );
      mockChatMessageRepository.create.mockReturnValue(mockChatMessage);
      mockChatMessageRepository.save.mockResolvedValue(mockChatMessage);

      const result = await service.sendMessage(userId, sendMessageDto);

      expect(mockServiceRequestRepo.create).not.toHaveBeenCalled();
      expect(mockServiceRequestRepo.save).not.toHaveBeenCalled();
      expect(mockEventEmitter.emit).not.toHaveBeenCalled();
      expect(result).toEqual(mockChatMessage);
    });

    it('should throw error if tenant not found', async () => {
      mockPropertyTenantRepo.findOne.mockResolvedValue(null);

      await expect(service.sendMessage(userId, sendMessageDto)).rejects.toThrow(
        'Tenant not found',
      );
    });

    it('should handle messages from non-tenant senders', async () => {
      const adminMessageDto: SendMessageDto = {
        ...sendMessageDto,
        sender: MessageSender.ADMIN,
      };

      const mockChatMessage = {
        id: 1,
        ...adminMessageDto,
        service_request_id: requestId,
      };

      mockChatMessageRepository.create.mockReturnValue(mockChatMessage);
      mockChatMessageRepository.save.mockResolvedValue(mockChatMessage);

      const result = await service.sendMessage(userId, adminMessageDto);

      expect(mockPropertyTenantRepo.findOne).not.toHaveBeenCalled();
      expect(result).toEqual(mockChatMessage);
    });

    it('should handle file messages', async () => {
      const fileMessageDto: SendMessageDto = {
        ...sendMessageDto,
        sender: MessageSender.ADMIN,
        type: MessageType.FILE,
        fileName: 'document.pdf',
        fileUrl: 'https://example.com/file.pdf',
      };

      const mockChatMessage = {
        id: 1,
        ...fileMessageDto,
        service_request_id: requestId,
      };

      mockChatMessageRepository.create.mockReturnValue(mockChatMessage);
      mockChatMessageRepository.save.mockResolvedValue(mockChatMessage);

      const result = await service.sendMessage(userId, fileMessageDto);

      expect(result).toEqual(mockChatMessage);
      expect(mockChatMessageRepository.create).toHaveBeenCalledWith({
        ...fileMessageDto,
        service_request_id: requestId,
      });
    });
  });

  describe('getAllMessagesForUser', () => {
    const mockQueryBuilder = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      addGroupBy: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      getRawMany: jest.fn(),
    };

    beforeEach(() => {
      mockChatMessageRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );
    });

    it('should return all conversations for admin user', async () => {
      const mockConversations = [
        {
          requestId: 'req-123',
          lastMessageAt: new Date(),
          messageCount: 5,
          unread: 2,
          tenant_name: 'John Doe',
          issue_category: 'maintenance',
          description: 'Leaking faucet',
          status: 'pending',
        },
      ];

      mockQueryBuilder.getRawMany.mockResolvedValue(mockConversations);

      const result = await service.getAllMessagesForUser('admin');

      expect(mockChatMessageRepository.createQueryBuilder).toHaveBeenCalledWith(
        'message',
      );
      expect(mockQueryBuilder.setParameter).toHaveBeenCalledWith(
        'normalizedUser',
        'admin',
      );
      expect(result).toEqual(mockConversations);
    });

    it('should normalize "rep" to "admin"', async () => {
      const mockConversations = [];
      mockQueryBuilder.getRawMany.mockResolvedValue(mockConversations);

      await service.getAllMessagesForUser('rep');

      expect(mockQueryBuilder.setParameter).toHaveBeenCalledWith(
        'normalizedUser',
        'admin',
      );
    });

    it('should return conversations for tenant user', async () => {
      const mockConversations = [
        {
          requestId: 'req-456',
          lastMessageAt: new Date(),
          messageCount: 3,
          unread: 1,
          tenant_name: 'Jane Smith',
          issue_category: 'repair',
          description: 'Broken window',
          status: 'in_progress',
        },
      ];

      mockQueryBuilder.getRawMany.mockResolvedValue(mockConversations);

      const result = await service.getAllMessagesForUser('tenant');

      expect(mockQueryBuilder.setParameter).toHaveBeenCalledWith(
        'normalizedUser',
        'tenant',
      );
      expect(result).toEqual(mockConversations);
    });
  });

  describe('getMessagesByRequestId', () => {
    const requestId = 'req-123';

    it('should return messages for a given request ID', async () => {
      const mockMessages = [
        {
          id: 1,
          service_request_id: requestId,
          sender: MessageSender.TENANT,
          content: 'First message',
          created_at: new Date('2024-01-01'),
        },
        {
          id: 2,
          service_request_id: requestId,
          sender: MessageSender.ADMIN,
          content: 'Reply message',
          created_at: new Date('2024-01-02'),
        },
      ];

      mockChatMessageRepository.find.mockResolvedValue(mockMessages);

      const result = await service.getMessagesByRequestId(requestId);

      expect(mockChatMessageRepository.find).toHaveBeenCalledWith({
        where: { service_request_id: requestId },
        relations: ['serviceRequest', 'serviceRequest.tenant.user'],
        order: { created_at: 'ASC' },
      });
      expect(result).toEqual(mockMessages);
    });

    it('should return empty array if no messages found', async () => {
      mockChatMessageRepository.find.mockResolvedValue([]);

      const result = await service.getMessagesByRequestId('nonexistent-id');

      expect(result).toEqual([]);
    });
  });

  describe('markMessagesAsRead', () => {
    const requestId = 'req-123';
    const sender = MessageSender.TENANT;

    it('should mark unread messages as read', async () => {
      mockChatMessageRepository.update.mockResolvedValue({ affected: 3 });

      await service.markMessagesAsRead(requestId, sender);

      expect(mockChatMessageRepository.update).toHaveBeenCalledWith(
        {
          service_request_id: requestId,
          sender: Not(sender),
          isRead: false,
        },
        { isRead: true },
      );
    });

    it('should only mark messages from other senders', async () => {
      await service.markMessagesAsRead(requestId, MessageSender.ADMIN);

      expect(mockChatMessageRepository.update).toHaveBeenCalledWith(
        expect.objectContaining({
          sender: Not(MessageSender.ADMIN),
        }),
        { isRead: true },
      );
    });
  });

  describe('markAsResolved', () => {
    const requestId = 'req-123';

    it('should update service request status to resolved', async () => {
      mockServiceRequestRepo.update.mockResolvedValue({ affected: 1 });

      await service.markAsResolved(requestId);

      expect(mockServiceRequestRepo.update).toHaveBeenCalledWith(
        { request_id: requestId },
        { status: ServiceRequestStatusEnum.RESOLVED },
      );
    });
  });

  describe('createSystemMessage', () => {
    it('should create a system message', async () => {
      const data = {
        serviceRequestId: 'req-123',
        content: 'Service request has been assigned',
      };

      const mockSystemMessage = {
        id: 1,
        serviceRequest: { id: data.serviceRequestId },
        sender: MessageSender.SYSTEM,
        type: MessageType.SYSTEM,
        content: data.content,
        senderName: 'System',
      };

      mockChatMessageRepository.save.mockResolvedValue(mockSystemMessage);

      const result = await service.createSystemMessage(data);

      expect(mockChatMessageRepository.save).toHaveBeenCalledWith({
        serviceRequest: { id: data.serviceRequestId },
        sender: MessageSender.SYSTEM,
        type: MessageType.SYSTEM,
        content: data.content,
        senderName: 'System',
      });
      expect(result).toEqual(mockSystemMessage);
    });
  });
});
