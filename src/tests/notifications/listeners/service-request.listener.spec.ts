import { Test, TestingModule } from '@nestjs/testing';
import { ServiceRequestListener } from 'src/notifications/listeners/service-request.listener';
import { NotificationService } from 'src/notifications/notification.service';
import { ServiceRequestCreatedEvent } from 'src/notifications/events/service-request.event';
import { NotificationType } from 'src/notifications/enums/notification-type';

describe('ServiceRequestListener', () => {
  let listener: ServiceRequestListener;
  let notificationService: NotificationService;

  const mockNotificationService = {
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceRequestListener,
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    listener = module.get<ServiceRequestListener>(ServiceRequestListener);
    notificationService = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(listener).toBeDefined();
  });

  describe('handle', () => {
    it('should create notification when service.created event is triggered', async () => {
      const event: ServiceRequestCreatedEvent = {
        service_request_id: 'request-123',
        user_id: 'user-456',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-789',
        property_name: 'Garden Apartments',
        tenant_name: 'Alice Johnson',
      };

      const mockNotification = {
        id: 'notification-999',
        type: NotificationType.SERVICE_REQUEST,
      };

      mockNotificationService.create.mockResolvedValue(mockNotification);

      listener.handle(event);

      expect(notificationService.create).toHaveBeenCalledWith({
        date: expect.any(String),
        type: NotificationType.SERVICE_REQUEST,
        description: `${event.tenant_name} made a service request for ${event.property_name}.`,
        status: 'Pending',
        property_id: event.property_id,
        user_id: event.user_id,
        service_request_id: event.service_request_id,
      });
    });

    it('should set status to Pending', async () => {
      const event: ServiceRequestCreatedEvent = {
        service_request_id: 'request-123',
        user_id: 'user-456',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-789',
        property_name: 'Garden Apartments',
        tenant_name: 'Alice Johnson',
      };

      listener.handle(event);

      const callArgs = mockNotificationService.create.mock.calls[0][0];
      expect(callArgs.status).toBe('Pending');
    });

    it('should include tenant name and property name in description', async () => {
      const event: ServiceRequestCreatedEvent = {
        service_request_id: 'request-123',
        user_id: 'user-456',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-789',
        property_name: 'Riverside Complex',
        tenant_name: 'Bob Williams',
      };

      listener.handle(event);

      const callArgs = mockNotificationService.create.mock.calls[0][0];
      expect(callArgs.description).toContain('Bob Williams');
      expect(callArgs.description).toContain('Riverside Complex');
    });

    it('should include service_request_id in notification', async () => {
      const event: ServiceRequestCreatedEvent = {
        service_request_id: 'request-abc-123',
        user_id: 'user-456',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-789',
        property_name: 'Garden Apartments',
        tenant_name: 'Alice Johnson',
      };

      listener.handle(event);

      const callArgs = mockNotificationService.create.mock.calls[0][0];
      expect(callArgs.service_request_id).toBe('request-abc-123');
    });

    it('should not throw error even if notification service fails (fire and forget)', async () => {
      const event: ServiceRequestCreatedEvent = {
        service_request_id: 'request-123',
        user_id: 'user-456',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-789',
        property_name: 'Garden Apartments',
        tenant_name: 'Alice Johnson',
      };

      mockNotificationService.create.mockRejectedValue(
        new Error('Database error'),
      );

      // Should not throw since handle is not async
      expect(() => listener.handle(event)).not.toThrow();
    });
  });
});
