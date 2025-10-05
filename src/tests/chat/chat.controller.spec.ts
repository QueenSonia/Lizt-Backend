import { Test, TestingModule } from '@nestjs/testing';
import { ClientResponse } from '@sendgrid/mail';
import { ChatController } from 'src/chat/chat.controller';
import { ChatService } from 'src/chat/chat.service';
import { UtilService } from 'src/utils/utility-service';

describe('ChatController', () => {
  let controller: ChatController;
  let chatService: ChatService;

  const mockChatService = {
    getAllMessagesForUser: jest.fn(),
    getMessagesByRequestId: jest.fn(),
    markAsResolved: jest.fn(),
  };

  const mockClientResponse: ClientResponse = {
    statusCode: 202,
    headers: {},
    body: {},
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChatController],
      providers: [
        {
          provide: ChatService,
          useValue: mockChatService,
        },
      ],
    }).compile();

    controller = module.get<ChatController>(ChatController);
    chatService = module.get<ChatService>(ChatService);

    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getAllConversations', () => {
    it('should return all conversations for admin user', async () => {
      const mockRequest = {
        user: { role: 'admin' },
      };

      const mockConversations = [
        {
          requestId: 'req-123',
          lastMessageAt: new Date(),
          messageCount: 5,
          unread: 2,
          tenant_name: 'John Doe',
        },
        {
          requestId: 'req-456',
          lastMessageAt: new Date(),
          messageCount: 3,
          unread: 0,
          tenant_name: 'Jane Smith',
        },
      ];

      mockChatService.getAllMessagesForUser.mockResolvedValue(
        mockConversations,
      );

      const result = await controller.getAllConversations(mockRequest);

      expect(chatService.getAllMessagesForUser).toHaveBeenCalledWith('admin');
      expect(result).toEqual(mockConversations);
    });

    it('should return all conversations for tenant user', async () => {
      const mockRequest = {
        user: { role: 'tenant' },
      };

      const mockConversations = [
        {
          requestId: 'req-789',
          lastMessageAt: new Date(),
          messageCount: 2,
          unread: 1,
          tenant_name: 'Bob Wilson',
        },
      ];

      mockChatService.getAllMessagesForUser.mockResolvedValue(
        mockConversations,
      );

      const result = await controller.getAllConversations(mockRequest);

      expect(chatService.getAllMessagesForUser).toHaveBeenCalledWith('tenant');
      expect(result).toEqual(mockConversations);
    });

    it('should handle rep role', async () => {
      const mockRequest = {
        user: { role: 'rep' },
      };

      mockChatService.getAllMessagesForUser.mockResolvedValue([]);

      await controller.getAllConversations(mockRequest);

      expect(chatService.getAllMessagesForUser).toHaveBeenCalledWith('rep');
    });
  });

  describe('getMessages', () => {
    it('should return messages for a specific request ID', async () => {
      const requestId = 'req-123';
      const mockMessages = [
        {
          id: 1,
          service_request_id: requestId,
          sender: 'tenant',
          content: 'Hello',
          created_at: new Date(),
        },
        {
          id: 2,
          service_request_id: requestId,
          sender: 'admin',
          content: 'Hi, how can I help?',
          created_at: new Date(),
        },
      ];

      mockChatService.getMessagesByRequestId.mockResolvedValue(mockMessages);

      const result = await controller.getMessages(requestId);

      expect(chatService.getMessagesByRequestId).toHaveBeenCalledWith(
        requestId,
      );
      expect(result).toEqual(mockMessages);
    });

    it('should handle non-existent request ID', async () => {
      const requestId = 'nonexistent-id';
      mockChatService.getMessagesByRequestId.mockResolvedValue([]);

      const result = await controller.getMessages(requestId);

      expect(result).toEqual([]);
    });
  });

  describe('sendMail', () => {
    beforeEach(() => {
      jest
        .spyOn(UtilService, 'sendEmail')
        .mockResolvedValue([mockClientResponse, {}]);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should send email with user email and message', async () => {
      const mockRequest = {
        user: { email: 'user@example.com' },
      };

      const body = {
        message: 'I need help with my service request',
      };

      await controller.sendMail(mockRequest, body);

      expect(UtilService.sendEmail).toHaveBeenCalledWith(
        'user@example.com',
        'Customer Contact',
        'I need help with my service request',
      );
    });

    it('should handle missing user email', async () => {
      const mockRequest = {
        user: {},
      };

      const body = {
        message: 'Test message',
      };

      await controller.sendMail(mockRequest, body);

      expect(UtilService.sendEmail).toHaveBeenCalledWith(
        undefined,
        'Customer Contact',
        'Test message',
      );
    });

    it('should handle empty message', async () => {
      const mockRequest = {
        user: { email: 'test@example.com' },
      };

      const body = {
        message: '',
      };

      await controller.sendMail(mockRequest, body);

      expect(UtilService.sendEmail).toHaveBeenCalledWith(
        'test@example.com',
        'Customer Contact',
        '',
      );
    });
  });

  describe('markAsResolved', () => {
    it('should mark service request as resolved', async () => {
      const mockRequest = {
        params: { requestId: 'req-123' },
      };

      mockChatService.markAsResolved.mockResolvedValue(undefined);

      await controller.markAsResolved(mockRequest);

      expect(chatService.markAsResolved).toHaveBeenCalledWith('req-123');
    });

    it('should handle different request IDs', async () => {
      const mockRequest = {
        params: { requestId: 'req-999' },
      };

      mockChatService.markAsResolved.mockResolvedValue(undefined);

      await controller.markAsResolved(mockRequest);

      expect(chatService.markAsResolved).toHaveBeenCalledWith('req-999');
    });
  });
});
