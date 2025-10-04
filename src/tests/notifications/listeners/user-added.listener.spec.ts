import { Test, TestingModule } from '@nestjs/testing';
import { UserAddedListener } from 'src/notifications/listeners/user-added.listener';
import { NotificationService } from 'src/notifications/notification.service';
import { UserAddedToPropertyEvent } from 'src/notifications/events/user-added.event';
import { NotificationType } from 'src/notifications/enums/notification-type';

describe('UserAddedListener', () => {
  let listener: UserAddedListener;
  let notificationService: NotificationService;

  const mockNotificationService = {
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserAddedListener,
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    listener = module.get<UserAddedListener>(UserAddedListener);
    notificationService = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(listener).toBeDefined();
  });

  describe('handle', () => {
    it('should create notification when user.added event is triggered', async () => {
      const event: UserAddedToPropertyEvent = {
        user_id: 'user-123',
        property_id: 'property-456',
        property_name: 'Skyline Tower',
        profile_name: 'Emma Davis',
        date: '2025-10-03T10:00:00Z',
      };

      const mockNotification = {
        id: 'notification-789',
        type: NotificationType.USER_ADDED_TO_PROPERTY,
      };

      mockNotificationService.create.mockResolvedValue(mockNotification);

      listener.handle(event);

      expect(notificationService.create).toHaveBeenCalledWith({
        date: expect.any(String),
        type: NotificationType.USER_ADDED_TO_PROPERTY,
        description: `${event.profile_name} was added to ${event.property_name} `,
        status: 'Completed',
        property_id: event.property_id,
        user_id: event.user_id,
      });
    });

    it('should include profile name and property name in description', async () => {
      const event: UserAddedToPropertyEvent = {
        user_id: 'user-123',
        property_id: 'property-456',
        property_name: 'Parkside Plaza',
        profile_name: 'Michael Brown',
        date: '2025-10-03T10:00:00Z',
      };

      listener.handle(event);

      const callArgs = mockNotificationService.create.mock.calls[0][0];
      expect(callArgs.description).toContain('Michael Brown');
      expect(callArgs.description).toContain('Parkside Plaza');
    });

    it('should set status to Completed', async () => {
      const event: UserAddedToPropertyEvent = {
        user_id: 'user-123',
        property_id: 'property-456',
        property_name: 'Hillside Homes',
        profile_name: 'Sarah Lee',
        date: '2025-10-03T10:00:00Z',
      };

      listener.handle(event);

      const callArgs = mockNotificationService.create.mock.calls[0][0];
      expect(callArgs.status).toBe('Completed');
    });

    it('should use current date for notification', async () => {
      const event: UserAddedToPropertyEvent = {
        user_id: 'user-123',
        property_id: 'property-456',
        property_name: 'Green Valley',
        profile_name: 'David Kim',
        date: '2025-10-03T10:00:00Z',
      };

      listener.handle(event);

      const callArgs = mockNotificationService.create.mock.calls[0][0];
      expect(callArgs.date).toBeDefined();
      expect(typeof callArgs.date).toBe('string');
    });
  });
});
