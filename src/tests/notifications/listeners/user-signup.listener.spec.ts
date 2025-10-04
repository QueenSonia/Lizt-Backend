import { Test, TestingModule } from '@nestjs/testing';
import { UserSignUpListener } from 'src/notifications/listeners/user-signup.listener';
import { NotificationService } from 'src/notifications/notification.service';
import { UserSignUpEvent } from 'src/notifications/events/user-signup.event';
import { NotificationType } from 'src/notifications/enums/notification-type';
import { NoticeAgreementCreatedEvent } from 'src/notifications/events/notice-created.event';

describe('UserSignUpListener', () => {
  let listener: UserSignUpListener;
  let notificationService: NotificationService;

  const mockNotificationService = {
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserSignUpListener,
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    listener = module.get<UserSignUpListener>(UserSignUpListener);
    notificationService = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(listener).toBeDefined();
  });

  describe('handle', () => {
    it('should create notification when user.signup event is triggered', async () => {
      const event: UserSignUpEvent = {
        user_id: 'user-123',
        profile_name: 'Jennifer Wilson',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-456',
      };

      const mockNotification = {
        id: 'notification-789',
        type: NotificationType.USER_SIGNED_UP,
      };

      mockNotificationService.create.mockResolvedValue(mockNotification);

      await listener.handle(event);

      expect(notificationService.create).toHaveBeenCalledWith({
        date: expect.any(String),
        type: NotificationType.USER_SIGNED_UP,
        description: `${event.profile_name} was just finished signing up and now have access to the tenant dashboard`,
        status: 'Completed',
        user_id: event.user_id,
        property_id: event.property_id,
      });
    });

    it('should include profile name in description', async () => {
      const event: UserSignUpEvent = {
        user_id: 'user-123',
        profile_name: 'Christopher Taylor',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-456',
      };

      await listener.handle(event);

      const callArgs = mockNotificationService.create.mock.calls[0][0];
      expect(callArgs.description).toContain('Christopher Taylor');
      expect(callArgs.description).toContain('tenant dashboard');
    });

    it('should set status to Completed', async () => {
      const event: UserSignUpEvent = {
        user_id: 'user-123',
        profile_name: 'Amanda Martinez',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-456',
      };

      await listener.handle(event);

      const callArgs = mockNotificationService.create.mock.calls[0][0];
      expect(callArgs.status).toBe('Completed');
    });

    it('should use current date for notification', async () => {
      const event: UserSignUpEvent = {
        user_id: 'user-123',
        profile_name: 'Robert Anderson',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-456',
      };

      await listener.handle(event);

      const callArgs = mockNotificationService.create.mock.calls[0][0];
      expect(callArgs.date).toBeDefined();
      expect(typeof callArgs.date).toBe('string');
    });

    it('should include property_id in notification', async () => {
      const event: UserSignUpEvent = {
        user_id: 'user-123',
        profile_name: 'Lisa Chen',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-xyz-789',
      };

      await listener.handle(event);

      const callArgs = mockNotificationService.create.mock.calls[0][0];
      expect(callArgs.property_id).toBe('property-xyz-789');
    });
  });

  it('should use current date when creating notification', async () => {
    const event: UserSignUpEvent = {
      user_id: 'user-123',
      profile_name: 'John Doe',
      date: '12-10-2025',
      property_id: 'property-456',
    };

    const beforeCall = new Date().toISOString();
    await listener.handle(event);
    const afterCall = new Date().toISOString();

    const callArgs = mockNotificationService.create.mock.calls[0][0];
    const dateUsed = callArgs.date;

    expect(new Date(dateUsed).getTime()).toBeGreaterThanOrEqual(
      new Date(beforeCall).getTime(),
    );
    expect(new Date(dateUsed).getTime()).toBeLessThanOrEqual(
      new Date(afterCall).getTime(),
    );
  });

  it('should include property name in description', async () => {
    const event: UserSignUpEvent = {
      user_id: 'user-123',
      profile_name: 'John Doe',
      date: '12-10-2025',
      property_id: 'property-456',
    };

    await listener.handle(event);

    const callArgs = mockNotificationService.create.mock.calls[0][0];
    expect(callArgs.description).toContain('Luxury Apartment');
  });

  it('should handle errors from notification service', async () => {
    const event: UserSignUpEvent = {
      user_id: 'user-123',
      profile_name: 'John Doe',
      date: '12-10-2025',
      property_id: 'property-456',
    };

    const error = new Error('Database error');
    mockNotificationService.create.mockRejectedValue(error);

    await expect(listener.handle(event)).rejects.toThrow('Database error');
  });
});
