import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { WhatsappBotService } from '../../src/whatsapp-bot/whatsapp-bot.service';
import { ChatLogService } from '../../src/whatsapp-bot/chat-log.service';
import { Users } from '../../src/users/entities/user.entity';
import { ServiceRequest } from '../../src/service-requests/entities/service-request.entity';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { TeamMember } from '../../src/users/entities/team-member.entity';
import { Waitlist } from '../../src/users/entities/waitlist.entity';
import { Property } from '../../src/properties/entities/property.entity';
import { Account } from '../../src/users/entities/account.entity';
import { LandlordFlow } from '../../src/whatsapp-bot/templates/landlord/landlordflow';
import { ServiceRequestsService } from '../../src/service-requests/service-requests.service';
import { CacheService } from '../../src/lib/cache';
import { UtilService } from '../../src/utils/utility-service';

describe('WhatsappBotService Integration', () => {
  let service: WhatsappBotService;
  let chatLogService: ChatLogService;
  let configService: ConfigService;

  const mockRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
  };

  const mockChatLogService = {
    logInboundMessage: jest.fn(),
    logOutboundMessage: jest.fn(),
    updateMessageStatus: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockCacheService = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
  };

  const mockServiceRequestsService = {
    createServiceRequest: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockLandlordFlow = {
    handleInteractive: jest.fn(),
    handleText: jest.fn(),
  };

  const mockUtilService = {
    normalizePhoneNumber: jest.fn(),
    toSentenceCase: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappBotService,
        {
          provide: ChatLogService,
          useValue: mockChatLogService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
        {
          provide: CacheService,
          useValue: mockCacheService,
        },
        {
          provide: ServiceRequestsService,
          useValue: mockServiceRequestsService,
        },
        {
          provide: LandlordFlow,
          useValue: mockLandlordFlow,
        },
        {
          provide: UtilService,
          useValue: mockUtilService,
        },
        {
          provide: getRepositoryToken(Users),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(ServiceRequest),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(PropertyTenant),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(TeamMember),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(Waitlist),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(Property),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<WhatsappBotService>(WhatsappBotService);
    chatLogService = module.get<ChatLogService>(ChatLogService);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(chatLogService).toBeDefined();
  });

  describe('handleMessage integration', () => {
    it('should log inbound messages when processing messages', async () => {
      // Arrange
      const mockMessage = {
        from: '2348123456789',
        type: 'text',
        text: { body: 'Hello' },
      };

      mockUtilService.normalizePhoneNumber.mockReturnValue('2348123456789');
      mockRepository.findOne.mockResolvedValue(null); // No user found
      mockChatLogService.logInboundMessage.mockResolvedValue({
        id: 'log-id',
        phone_number: '2348123456789',
        direction: 'INBOUND',
        message_type: 'text',
        content: 'Hello',
      });

      // Act
      await service.handleMessage([mockMessage]);

      // Assert
      expect(mockChatLogService.logInboundMessage).toHaveBeenCalledWith(
        '2348123456789',
        'text',
        'Hello',
        mockMessage,
      );
    });

    it('should continue processing even if logging fails', async () => {
      // Arrange
      const mockMessage = {
        from: '2348123456789',
        type: 'text',
        text: { body: 'Hello' },
      };

      mockUtilService.normalizePhoneNumber.mockReturnValue('2348123456789');
      mockRepository.findOne.mockResolvedValue(null);
      mockChatLogService.logInboundMessage.mockRejectedValue(
        new Error('Logging failed'),
      );

      // Act & Assert - Should not throw
      await expect(service.handleMessage([mockMessage])).resolves.not.toThrow();
      expect(mockChatLogService.logInboundMessage).toHaveBeenCalled();
    });
  });

  describe('sendToWhatsappAPI integration', () => {
    beforeEach(() => {
      mockConfigService.get.mockImplementation((key) => {
        if (key === 'WA_PHONE_NUMBER_ID') return 'test-phone-id';
        if (key === 'CLOUD_API_ACCESS_TOKEN') return 'test-token';
        return null;
      });

      // Mock fetch globally
      global.fetch = jest.fn();
    });

    it('should log outbound messages when sending to WhatsApp API', async () => {
      // Arrange
      const mockPayload = {
        messaging_product: 'whatsapp',
        to: '2348123456789',
        type: 'text',
        text: { body: 'Hello from bot' },
      };

      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ id: 'wamid.test123' }],
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);
      mockChatLogService.logOutboundMessage.mockResolvedValue({
        id: 'log-id',
        phone_number: '2348123456789',
        direction: 'OUTBOUND',
        message_type: 'text',
        content: 'Hello from bot',
      });

      // Act
      const result = await service.sendToWhatsappAPI(mockPayload);

      // Assert
      expect(mockChatLogService.logOutboundMessage).toHaveBeenCalledWith(
        '2348123456789',
        'text',
        'Hello from bot',
        mockPayload,
        'wamid.test123',
      );
      expect(result).toEqual({
        messages: [{ id: 'wamid.test123' }],
      });
    });

    it('should continue processing even if outbound logging fails', async () => {
      // Arrange
      const mockPayload = {
        messaging_product: 'whatsapp',
        to: '2348123456789',
        type: 'text',
        text: { body: 'Hello from bot' },
      };

      const mockResponse = {
        ok: true,
        json: jest.fn().mockResolvedValue({
          messages: [{ id: 'wamid.test123' }],
        }),
      };

      (global.fetch as jest.Mock).mockResolvedValue(mockResponse);
      mockChatLogService.logOutboundMessage.mockRejectedValue(
        new Error('Logging failed'),
      );

      // Act & Assert - Should not throw and should return response
      const result = await service.sendToWhatsappAPI(mockPayload);
      expect(result).toEqual({
        messages: [{ id: 'wamid.test123' }],
      });
      expect(mockChatLogService.logOutboundMessage).toHaveBeenCalled();
    });
  });

  describe('message content extraction', () => {
    it('should extract text content correctly', async () => {
      // Arrange
      const mockMessage = {
        from: '2348123456789',
        type: 'text',
        text: { body: 'Test message' },
      };

      mockUtilService.normalizePhoneNumber.mockReturnValue('2348123456789');
      mockRepository.findOne.mockResolvedValue(null);
      mockChatLogService.logInboundMessage.mockResolvedValue({});

      // Act
      await service.handleMessage([mockMessage]);

      // Assert
      expect(mockChatLogService.logInboundMessage).toHaveBeenCalledWith(
        '2348123456789',
        'text',
        'Test message',
        mockMessage,
      );
    });

    it('should extract button content correctly', async () => {
      // Arrange
      const mockMessage = {
        from: '2348123456789',
        type: 'interactive',
        interactive: {
          button_reply: {
            id: 'button_id',
            title: 'Button Title',
          },
        },
      };

      mockUtilService.normalizePhoneNumber.mockReturnValue('2348123456789');
      mockRepository.findOne.mockResolvedValue(null);
      mockChatLogService.logInboundMessage.mockResolvedValue({});

      // Act
      await service.handleMessage([mockMessage]);

      // Assert
      expect(mockChatLogService.logInboundMessage).toHaveBeenCalledWith(
        '2348123456789',
        'interactive',
        'Button: Button Title',
        mockMessage,
      );
    });
  });
});
