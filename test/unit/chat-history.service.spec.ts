import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatHistoryService } from 'src/whatsapp-bot/chat-history.service';
import { ChatLog } from 'src/whatsapp-bot/entities/chat-log.entity';
import { MessageDirection } from 'src/whatsapp-bot/entities/message-direction.enum';
import { MessageStatus } from 'src/whatsapp-bot/entities/message-status.enum';

describe('ChatHistoryService', () => {
  let service: ChatHistoryService;
  let repository: Repository<ChatLog>;

  const mockRepository = {
    createQueryBuilder: jest.fn(() => ({
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    })),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChatHistoryService,
        {
          provide: getRepositoryToken(ChatLog),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<ChatHistoryService>(ChatHistoryService);
    repository = module.get<Repository<ChatLog>>(getRepositoryToken(ChatLog));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getChatHistory', () => {
    it('should return chat history for a phone number', async () => {
      const phoneNumber = '+1234567890';
      const mockChatLogs: ChatLog[] = [
        {
          id: '1',
          phone_number: phoneNumber,
          direction: MessageDirection.INBOUND,
          message_type: 'text',
          content: 'Hello',
          metadata: {},
          whatsapp_message_id: undefined,
          status: MessageStatus.SENT,
          error_code: undefined,
          error_reason: undefined,
          created_at: new Date(),
          user: undefined,
          user_id: undefined,
        } as ChatLog,
      ];

      const queryBuilder = mockRepository.createQueryBuilder();
      queryBuilder.getMany.mockResolvedValue(mockChatLogs);

      const result = await service.getChatHistory(phoneNumber);

      expect(result).toEqual(mockChatLogs);
      expect(queryBuilder.where).toHaveBeenCalledWith(
        'chat_log.phone_number = :phoneNumber',
        { phoneNumber },
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'chat_log.created_at',
        'ASC',
      );
    });

    it('should apply filters correctly', async () => {
      const phoneNumber = '+1234567890';
      const options = {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
        status: MessageStatus.DELIVERED,
        direction: MessageDirection.OUTBOUND,
        limit: 10,
        offset: 0,
      };

      const queryBuilder = mockRepository.createQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([]);

      await service.getChatHistory(phoneNumber, options);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'chat_log.created_at >= :startDate',
        { startDate: options.startDate },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'chat_log.created_at <= :endDate',
        { endDate: options.endDate },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'chat_log.status = :status',
        { status: options.status },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'chat_log.direction = :direction',
        { direction: options.direction },
      );
      expect(queryBuilder.limit).toHaveBeenCalledWith(options.limit);
      expect(queryBuilder.offset).toHaveBeenCalledWith(options.offset);
    });
  });

  describe('searchMessages', () => {
    it('should search messages with multiple filters', async () => {
      const searchOptions = {
        phoneNumber: '+1234567890',
        content: 'hello',
        status: MessageStatus.DELIVERED,
      };

      const queryBuilder = mockRepository.createQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([]);

      await service.searchMessages(searchOptions);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'chat_log.phone_number = :phoneNumber',
        { phoneNumber: searchOptions.phoneNumber },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'LOWER(chat_log.content) LIKE LOWER(:content)',
        { content: `%${searchOptions.content}%` },
      );
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'chat_log.status = :status',
        { status: searchOptions.status },
      );
    });
  });

  describe('searchByContent', () => {
    it('should search messages by content', async () => {
      const searchTerm = 'hello world';
      const queryBuilder = mockRepository.createQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([]);

      await service.searchByContent(searchTerm);

      expect(queryBuilder.where).toHaveBeenCalledWith(
        'LOWER(chat_log.content) LIKE LOWER(:searchTerm)',
        { searchTerm: `%${searchTerm}%` },
      );
    });
  });

  describe('getDeliveryStatistics', () => {
    it('should return empty stats for no messages', async () => {
      const queryBuilder = mockRepository.createQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([]);

      const result = await service.getDeliveryStatistics();

      expect(result).toEqual({
        totalMessages: 0,
        sentCount: 0,
        deliveredCount: 0,
        readCount: 0,
        failedCount: 0,
        deliveryRate: 0,
        readRate: 0,
        commonErrors: [],
      });
    });

    it('should calculate delivery statistics correctly', async () => {
      const mockMessages: ChatLog[] = [
        {
          id: '1',
          phone_number: '+1234567890',
          direction: MessageDirection.OUTBOUND,
          message_type: 'text',
          content: 'Hello',
          metadata: {},
          whatsapp_message_id: 'wamid1',
          status: MessageStatus.DELIVERED,
          error_code: undefined,
          error_reason: undefined,
          created_at: new Date(),
          user: undefined,
          user_id: undefined,
        } as ChatLog,
        {
          id: '2',
          phone_number: '+1234567890',
          direction: MessageDirection.OUTBOUND,
          message_type: 'text',
          content: 'World',
          metadata: {},
          whatsapp_message_id: 'wamid2',
          status: MessageStatus.READ,
          error_code: undefined,
          error_reason: undefined,
          created_at: new Date(),
          user: undefined,
          user_id: undefined,
        } as ChatLog,
        {
          id: '3',
          phone_number: '+1234567890',
          direction: MessageDirection.OUTBOUND,
          message_type: 'text',
          content: 'Failed',
          metadata: {},
          whatsapp_message_id: 'wamid3',
          status: MessageStatus.FAILED,
          error_code: '131026',
          error_reason: 'Phone number not on WhatsApp',
          created_at: new Date(),
          user: undefined,
          user_id: undefined,
        } as ChatLog,
      ];

      const queryBuilder = mockRepository.createQueryBuilder();
      queryBuilder.getMany.mockResolvedValue(mockMessages);

      const result = await service.getDeliveryStatistics();

      expect(result.totalMessages).toBe(3);
      expect(result.deliveredCount).toBe(1);
      expect(result.readCount).toBe(1);
      expect(result.failedCount).toBe(1);
      expect(result.deliveryRate).toBe(66.67); // (1 + 1) / 3 * 100
      expect(result.readRate).toBe(33.33); // 1 / 3 * 100
      expect(result.commonErrors).toHaveLength(1);
      expect(result.commonErrors[0]).toEqual({
        errorCode: '131026',
        errorReason: 'Phone number not on WhatsApp',
        count: 1,
        percentage: 100,
      });
    });
  });
});
