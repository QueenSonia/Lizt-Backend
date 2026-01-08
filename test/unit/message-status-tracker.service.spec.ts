import { Test, TestingModule } from '@nestjs/testing';
import {
  MessageStatusTracker,
  WhatsAppStatusUpdate,
  WhatsAppError,
} from '../../src/whatsapp-bot/message-status-tracker.service';
import { ChatLogService } from '../../src/whatsapp-bot/chat-log.service';
import { MessageStatus } from '../../src/whatsapp-bot/entities/message-status.enum';

describe('MessageStatusTracker', () => {
  let service: MessageStatusTracker;
  let chatLogService: jest.Mocked<ChatLogService>;

  beforeEach(async () => {
    const mockChatLogService = {
      updateMessageStatus: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageStatusTracker,
        {
          provide: ChatLogService,
          useValue: mockChatLogService,
        },
      ],
    }).compile();

    service = module.get<MessageStatusTracker>(MessageStatusTracker);
    chatLogService = module.get(ChatLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('processStatusUpdate', () => {
    it('should handle delivered status', async () => {
      const statusUpdate: WhatsAppStatusUpdate = {
        id: 'wamid.test123',
        status: 'delivered',
        timestamp: '2024-01-01T00:00:00Z',
        recipient_id: '+1234567890',
      };

      await service.processStatusUpdate(statusUpdate);

      expect(chatLogService.updateMessageStatus).toHaveBeenCalledWith(
        'wamid.test123',
        MessageStatus.DELIVERED,
      );
    });

    it('should handle read status', async () => {
      const statusUpdate: WhatsAppStatusUpdate = {
        id: 'wamid.test123',
        status: 'read',
        timestamp: '2024-01-01T00:00:00Z',
        recipient_id: '+1234567890',
      };

      await service.processStatusUpdate(statusUpdate);

      expect(chatLogService.updateMessageStatus).toHaveBeenCalledWith(
        'wamid.test123',
        MessageStatus.READ,
      );
    });

    it('should handle failed status with error', async () => {
      const error: WhatsAppError = {
        code: 131026,
        title: 'Phone number not on WhatsApp',
      };

      const statusUpdate: WhatsAppStatusUpdate = {
        id: 'wamid.test123',
        status: 'failed',
        timestamp: '2024-01-01T00:00:00Z',
        recipient_id: '+1234567890',
        errors: [error],
      };

      await service.processStatusUpdate(statusUpdate);

      expect(chatLogService.updateMessageStatus).toHaveBeenCalledWith(
        'wamid.test123',
        MessageStatus.FAILED,
        '131026',
        'Phone number not on WhatsApp or user blocked business',
      );
    });

    it('should handle failed status without specific error', async () => {
      const statusUpdate: WhatsAppStatusUpdate = {
        id: 'wamid.test123',
        status: 'failed',
        timestamp: '2024-01-01T00:00:00Z',
        recipient_id: '+1234567890',
      };

      await service.processStatusUpdate(statusUpdate);

      expect(chatLogService.updateMessageStatus).toHaveBeenCalledWith(
        'wamid.test123',
        MessageStatus.FAILED,
        '131000',
        'Generic error - retry later or check request format',
      );
    });
  });

  describe('mapErrorCodeToReason', () => {
    it('should map known error codes correctly', () => {
      const errorCodes = service.getSupportedErrorCodes();

      expect(errorCodes['131026']).toBe(
        'Phone number not on WhatsApp or user blocked business',
      );
      expect(errorCodes['131047']).toBe(
        '24-hour messaging window expired - template message required',
      );
      expect(errorCodes['131048']).toBe(
        'Rate limit exceeded - too many messages sent',
      );
      expect(errorCodes['368']).toBe(
        'Account temporarily blocked - check WhatsApp Manager',
      );
    });

    it('should return all supported error codes', () => {
      const errorCodes = service.getSupportedErrorCodes();

      // Check that we have all the required error codes from the requirements
      expect(errorCodes).toHaveProperty('131026');
      expect(errorCodes).toHaveProperty('131047');
      expect(errorCodes).toHaveProperty('131048');
      expect(errorCodes).toHaveProperty('131049');
      expect(errorCodes).toHaveProperty('130429');
      expect(errorCodes).toHaveProperty('131056');
      expect(errorCodes).toHaveProperty('368');
      expect(errorCodes).toHaveProperty('131031');
      expect(errorCodes).toHaveProperty('132000');
      expect(errorCodes).toHaveProperty('132001');
      expect(errorCodes).toHaveProperty('132007');
      expect(errorCodes).toHaveProperty('131000');
      expect(errorCodes).toHaveProperty('131021');
      expect(errorCodes).toHaveProperty('131051');
      expect(errorCodes).toHaveProperty('131053');
    });

    it('should check if error code is supported', () => {
      expect(service.isErrorCodeSupported('131026')).toBe(true);
      expect(service.isErrorCodeSupported('999999')).toBe(false);
    });
  });

  describe('individual status handlers', () => {
    it('should handle delivery confirmation', async () => {
      await service.handleDeliveryConfirmation('wamid.test123');

      expect(chatLogService.updateMessageStatus).toHaveBeenCalledWith(
        'wamid.test123',
        MessageStatus.DELIVERED,
      );
    });

    it('should handle read receipt', async () => {
      await service.handleReadReceipt('wamid.test123');

      expect(chatLogService.updateMessageStatus).toHaveBeenCalledWith(
        'wamid.test123',
        MessageStatus.READ,
      );
    });

    it('should handle delivery failure', async () => {
      const error: WhatsAppError = {
        code: 131048,
        title: 'Rate limit exceeded',
      };

      await service.handleDeliveryFailure('wamid.test123', error);

      expect(chatLogService.updateMessageStatus).toHaveBeenCalledWith(
        'wamid.test123',
        MessageStatus.FAILED,
        '131048',
        'Rate limit exceeded - too many messages sent',
      );
    });
  });
});
