import { Test, TestingModule } from '@nestjs/testing';
import { NoticeAgreementListener } from 'src/notifications/listeners/notice-agreement.listener';
import { NotificationService } from 'src/notifications/notification.service';
import { NoticeAgreementCreatedEvent } from 'src/notifications/events/notice-created.event';
import { NotificationType } from 'src/notifications/enums/notification-type';
import { PropertyCreatedEvent } from 'src/notifications/events/property-created.event';

describe('NoticeAgreementListener', () => {
  let listener: NoticeAgreementListener;
  let notificationService: NotificationService;

  const mockNotificationService = {
    create: jest.fn(),
  };

  const mockEvent: NoticeAgreementCreatedEvent = {
    notice_id: 1,
    user_id: 'user-123',
    date: '2025-10-03T10:00:00Z',
    property_id: 'property-456',
    property_name: 'Sunset Villa',
    tenant_name: 'John Doe',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NoticeAgreementListener,
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    listener = module.get<NoticeAgreementListener>(NoticeAgreementListener);
    notificationService = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(listener).toBeDefined();
  });

  describe('handle', () => {
    it('should create notification when notice.created event is triggered', async () => {
      const mockNotification = {
        id: 'notification-789',
        type: NotificationType.NOTICE_AGREEMENT,
        status: 'Completed',
      };

      mockNotificationService.create.mockResolvedValue(mockNotification);

      await listener.handle(mockEvent);

      expect(notificationService.create).toHaveBeenCalledWith({
        date: expect.any(String),
        type: NotificationType.NOTICE_AGREEMENT,
        description: `New property ${mockEvent.property_name} was created.`,
        status: 'Completed',
        property_id: mockEvent.property_id,
        user_id: mockEvent.user_id,
      });
    });

    it('should include property name in description', async () => {
      await listener.handle(mockEvent);

      const callArgs = mockNotificationService.create.mock.calls[0][0];
      expect(callArgs.description).toContain('Downtown Loft');
    });

    it('should set status to Completed', async () => {
      await listener.handle(mockEvent);

      const callArgs = mockNotificationService.create.mock.calls[0][0];
      expect(callArgs.status).toBe('Completed');
    });

    it('should handle errors from notification service', async () => {
      const error = new Error('Service unavailable');
      mockNotificationService.create.mockRejectedValue(error);

      await expect(listener.handle(mockEvent)).rejects.toThrow(
        'Service unavailable',
      );
    });
  });
});
