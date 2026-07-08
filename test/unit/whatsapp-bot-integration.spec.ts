import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { WhatsappBotService } from '../../src/whatsapp-bot/whatsapp-bot.service';
import { ChatLogService } from '../../src/whatsapp-bot/chat-log.service';
import { WebhookHandler } from '../../src/whatsapp-bot/webhook-handler.service';
import { MessageStatusTracker } from '../../src/whatsapp-bot/message-status-tracker.service';
import { TemplateSenderService } from '../../src/whatsapp-bot/template-sender';
import { TenantFlowService } from '../../src/whatsapp-bot/tenant-flow';
import { LandlordFlowService } from '../../src/whatsapp-bot/landlord-flow';
import { FlowTokenService } from '../../src/whatsapp-bot/flow-token.service';
import { UnknownsAiService } from '../../src/whatsapp-bot/unknowns-ai.service';
import { ApplicantAiService } from '../../src/whatsapp-bot/applicant-ai.service';
import { PasswordService } from '../../src/users/password';
import { RenewalPDFService } from '../../src/pdf/renewal-pdf.service';
import { Users } from '../../src/users/entities/user.entity';
import { MaintenanceRequest } from '../../src/maintenance-requests/entities/maintenance-request.entity';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { TeamMember } from '../../src/users/entities/team-member.entity';
import { Waitlist } from '../../src/users/entities/waitlist.entity';
import { Property } from '../../src/properties/entities/property.entity';
import { Account } from '../../src/users/entities/account.entity';
import { KYCApplication } from '../../src/kyc-links/entities/kyc-application.entity';
import { LandlordFlow } from '../../src/whatsapp-bot/templates/landlord/landlordflow';
import { MaintenanceRequestsService } from '../../src/maintenance-requests/maintenance-requests.service';
import { CacheService } from '../../src/lib/cache';
import { UtilService } from '../../src/utils/utility-service';

// The `whatsapp` SDK reads WA_* env vars inside its constructor and throws
// when they are missing. WhatsappBotService instantiates it as a field
// initializer (`private wa = new WhatsApp()`), so it must be mocked before
// the service class can be constructed in a test environment.
jest.mock('whatsapp', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({})),
}));

describe('WhatsappBotService Integration', () => {
  let service: WhatsappBotService;
  let chatLogService: ChatLogService;
  let webhookHandler: WebhookHandler;

  // Drain the microtask queue so fire-and-forget promises (`void promise`)
  // inside the services settle before we assert.
  const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

  const mockRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  };

  const mockChatLogService = {
    logInboundMessage: jest.fn(),
    logOutboundMessage: jest.fn(),
    updateMessageStatus: jest.fn(),
    getChatHistory: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  const mockCacheService = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    deleteMultiple: jest.fn(),
  };

  const mockMaintenanceRequestsService = {
    createMaintenanceRequest: jest.fn(),
    updateStatus: jest.fn(),
  };

  const mockLandlordFlow = {
    handleInteractive: jest.fn(),
    handleText: jest.fn(),
  };

  const mockUtilService = {
    normalizePhoneNumber: jest.fn(),
    toSentenceCase: jest.fn(),
    sanitizeTemplateParam: jest.fn((v: string) => v),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  const mockTenantFlowService = {
    handleInteractive: jest.fn(),
    handleText: jest.fn(),
  };

  const mockLandlordFlowService = {
    handleFacilityInteractive: jest.fn(),
    handleFacilityText: jest.fn(),
    handleInteractive: jest.fn(),
    handleText: jest.fn(),
  };

  const mockPasswordService = {
    setPassword: jest.fn(),
    validatePassword: jest.fn(),
  };

  const mockFlowTokenService = {
    mint: jest.fn(),
    verify: jest.fn(),
  };

  const mockUnknownsAiService = {
    tryHandle: jest.fn(),
  };

  const mockApplicantAiService = {
    tryHandle: jest.fn(),
  };

  const mockMessageStatusTracker = {
    processStatusUpdate: jest.fn(),
  };

  const mockRenewalPDFService = {
    generateRenewalInvoicePDF: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    // Default: production mode (WHATSAPP_SIMULATOR unset) with API creds.
    mockConfigService.get.mockImplementation((key: string) => {
      if (key === 'WA_PHONE_NUMBER_ID') return 'test-phone-id';
      if (key === 'CLOUD_API_ACCESS_TOKEN') return 'test-token';
      return null;
    });

    mockUnknownsAiService.tryHandle.mockResolvedValue(false);
    mockApplicantAiService.tryHandle.mockResolvedValue(false);

    // Default fetch mock so any outbound send resolves cleanly.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ messages: [{ id: 'wamid.default' }] }),
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappBotService,
        // Real collaborators under integration test: the webhook handler now
        // owns inbound chat logging, and the template sender owns the actual
        // WhatsApp Cloud API call + outbound chat logging.
        WebhookHandler,
        TemplateSenderService,
        {
          provide: ChatLogService,
          useValue: mockChatLogService,
        },
        {
          provide: MessageStatusTracker,
          useValue: mockMessageStatusTracker,
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
          provide: MaintenanceRequestsService,
          useValue: mockMaintenanceRequestsService,
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
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: TenantFlowService,
          useValue: mockTenantFlowService,
        },
        {
          provide: LandlordFlowService,
          useValue: mockLandlordFlowService,
        },
        {
          provide: PasswordService,
          useValue: mockPasswordService,
        },
        {
          provide: FlowTokenService,
          useValue: mockFlowTokenService,
        },
        {
          provide: UnknownsAiService,
          useValue: mockUnknownsAiService,
        },
        {
          provide: ApplicantAiService,
          useValue: mockApplicantAiService,
        },
        {
          provide: RenewalPDFService,
          useValue: mockRenewalPDFService,
        },
        {
          provide: getRepositoryToken(Users),
          useValue: mockRepository,
        },
        {
          provide: getRepositoryToken(MaintenanceRequest),
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
        {
          provide: getRepositoryToken(KYCApplication),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<WhatsappBotService>(WhatsappBotService);
    chatLogService = module.get<ChatLogService>(ChatLogService);
    webhookHandler = module.get<WebhookHandler>(WebhookHandler);
  });

  afterEach(async () => {
    await flushAsync();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(chatLogService).toBeDefined();
    expect(webhookHandler).toBeDefined();
  });

  describe('inbound message logging (WebhookHandler integration)', () => {
    // Inbound chat logging moved from WhatsappBotService.handleMessage to
    // WebhookHandler.processIncomingMessage to avoid duplicate DB rows.

    it('should log inbound messages when processing webhook messages', async () => {
      // Arrange
      const mockMessage = {
        from: '2348123456789',
        id: 'wamid.test123',
        timestamp: '1234567890',
        type: 'text',
        text: { body: 'Hello' },
      };

      mockChatLogService.logInboundMessage.mockResolvedValue({
        id: 'log-id',
        phone_number: '2348123456789',
        direction: 'INBOUND',
        message_type: 'text',
        content: 'Hello',
      });

      // Act
      await webhookHandler.handleMessageWebhook([mockMessage as any]);
      await flushAsync();

      // Assert
      expect(mockChatLogService.logInboundMessage).toHaveBeenCalledWith(
        '2348123456789',
        'text',
        'Hello',
        expect.objectContaining({
          whatsapp_message_id: 'wamid.test123',
          timestamp: '1234567890',
          raw_message: mockMessage,
          is_simulated: false,
          simulation_status: 'production_message',
          message_source: 'whatsapp_cloud_api',
        }),
      );
    });

    it('should continue processing even if logging fails', async () => {
      // Arrange
      const mockMessage = {
        from: '2348123456789',
        id: 'wamid.test456',
        timestamp: '1234567890',
        type: 'text',
        text: { body: 'Hello' },
      };

      mockChatLogService.logInboundMessage.mockRejectedValue(
        new Error('Logging failed'),
      );

      // Act & Assert - Should not throw (log write is fire-and-forget)
      await expect(
        webhookHandler.handleMessageWebhook([mockMessage as any]),
      ).resolves.not.toThrow();
      await flushAsync();
      expect(mockChatLogService.logInboundMessage).toHaveBeenCalled();
    });
  });

  describe('message content extraction', () => {
    it('should extract text content correctly', async () => {
      // Arrange
      const mockMessage = {
        from: '2348123456789',
        id: 'wamid.text1',
        timestamp: '1234567890',
        type: 'text',
        text: { body: 'Test message' },
      };

      mockChatLogService.logInboundMessage.mockResolvedValue({});

      // Act
      await webhookHandler.handleMessageWebhook([mockMessage as any]);
      await flushAsync();

      // Assert
      expect(mockChatLogService.logInboundMessage).toHaveBeenCalledWith(
        '2348123456789',
        'text',
        'Test message',
        expect.objectContaining({ raw_message: mockMessage }),
      );
    });

    it('should extract button content correctly', async () => {
      // Arrange
      const mockMessage = {
        from: '2348123456789',
        id: 'wamid.button1',
        timestamp: '1234567890',
        type: 'interactive',
        interactive: {
          button_reply: {
            id: 'button_id',
            title: 'Button Title',
          },
        },
      };

      mockChatLogService.logInboundMessage.mockResolvedValue({});

      // Act
      await webhookHandler.handleMessageWebhook([mockMessage as any]);
      await flushAsync();

      // Assert - button replies are logged with the button title as content
      expect(mockChatLogService.logInboundMessage).toHaveBeenCalledWith(
        '2348123456789',
        'interactive',
        'Button Title',
        expect.objectContaining({ raw_message: mockMessage }),
      );
    });
  });

  describe('handleMessage integration', () => {
    it('should not log inbound messages itself (WebhookHandler owns inbound logging) and should route unknown users to the unknowns handler', async () => {
      // Arrange - a text message from a phone with no user/account/KYC record
      const mockMessage = {
        from: '2348123456789',
        id: 'wamid.test123',
        timestamp: '1234567890',
        type: 'text',
        text: { body: 'Hello' },
      };

      mockUtilService.normalizePhoneNumber.mockReturnValue('2348123456789');
      mockRepository.findOne.mockResolvedValue(null); // No user found
      mockCacheService.get.mockResolvedValue(undefined);
      // Short-circuit the unknowns flow at the AI gate so the test stays
      // deterministic (no template/button sends).
      mockUnknownsAiService.tryHandle.mockResolvedValue(true);

      // Act
      await service.handleMessage([mockMessage as any]);
      await flushAsync();

      // Assert - no duplicate inbound logging from handleMessage
      expect(mockChatLogService.logInboundMessage).not.toHaveBeenCalled();
      // ...and the message was routed to the default/unknowns handler
      expect(mockUnknownsAiService.tryHandle).toHaveBeenCalledWith(
        '2348123456789',
        'Hello',
      );
    });

    it('should continue processing without throwing for unknown users', async () => {
      // Arrange
      const mockMessage = {
        from: '2348123456789',
        id: 'wamid.test789',
        timestamp: '1234567890',
        type: 'text',
        text: { body: 'Hello' },
      };

      mockUtilService.normalizePhoneNumber.mockReturnValue('2348123456789');
      mockRepository.findOne.mockResolvedValue(null);
      mockCacheService.get.mockResolvedValue(undefined);
      mockUnknownsAiService.tryHandle.mockResolvedValue(true);

      // Act & Assert - Should not throw
      await expect(
        service.handleMessage([mockMessage as any]),
      ).resolves.not.toThrow();
      await flushAsync();
    });
  });

  describe('sendToWhatsappAPI integration', () => {
    // WhatsappBotService.sendToWhatsappAPI delegates to the real
    // TemplateSenderService, which performs the Cloud API fetch and logs
    // the outbound message (fire-and-forget).

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
        status: 200,
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
      await flushAsync();
      expect(mockChatLogService.logOutboundMessage).toHaveBeenCalledWith(
        '2348123456789',
        'text',
        'Hello from bot',
        expect.objectContaining({
          messaging_product: 'whatsapp',
          to: '2348123456789',
          is_simulated: false,
          simulation_status: 'production_message',
        }),
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
        status: 200,
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
      await flushAsync();
      expect(result).toEqual({
        messages: [{ id: 'wamid.test123' }],
      });
      expect(mockChatLogService.logOutboundMessage).toHaveBeenCalled();
    });
  });
});
