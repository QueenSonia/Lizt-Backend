import { Test, TestingModule } from '@nestjs/testing';
import { PropertyListener } from 'src/notifications/listeners/property-created.listener';
import { NotificationService } from 'src/notifications/notification.service';
import { PropertyCreatedEvent } from 'src/notifications/events/property-created.event';
import { NotificationType } from 'src/notifications/enums/notification-type';
import { v4 as uuidv4 } from 'uuid';

describe('PropertyListener', () => {
  let listener: PropertyListener;
  let notificationService: NotificationService;

  const mockNotificationService = {
    create: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropertyListener,
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    listener = module.get<PropertyListener>(PropertyListener);
    notificationService = module.get<NotificationService>(NotificationService);
  });

  it('should be defined', () => {
    expect(listener).toBeDefined();
  });

  it('should handle property.created event and create a notification', async () => {
    const event: PropertyCreatedEvent = {
      property_id: uuidv4(),
      property_name: 'Maple View',
      user_id: uuidv4(),
    };

    await listener.handlePropertyCreated(event);

    expect(notificationService.create).toHaveBeenCalledWith({
      date: expect.any(String),
      type: NotificationType.PROPERTY_CREATED,
      description: `New property ${event.property_name} was created.`,
      status: 'Completed',
      property_id: event.property_id,
      user_id: event.user_id,
    });
  });
});
