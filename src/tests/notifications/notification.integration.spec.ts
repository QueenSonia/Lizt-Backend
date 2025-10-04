import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationModule } from 'src/notifications/notification.module';
import { NotificationService } from 'src/notifications/notification.service';
import { Notification } from 'src/notifications/entities/notification.entity';
import { NoticeAgreementListener } from 'src/notifications/listeners/notice-agreement.listener';
import { PropertyListener } from 'src/notifications/listeners/property-created.listener';
import { ServiceRequestListener } from 'src/notifications/listeners/service-request.listener';
import { UserAddedListener } from 'src/notifications/listeners/user-added.listener';
import { UserSignUpListener } from 'src/notifications/listeners/user-signup.listener';
import { NotificationType } from 'src/notifications/enums/notification-type';
import { NoticeAgreementCreatedEvent } from 'src/notifications/events/notice-created.event';
import { PropertyCreatedEvent } from 'src/notifications/events/property-created.event';
import { ServiceRequestCreatedEvent } from 'src/notifications/events/service-request.event';
import { UserAddedToPropertyEvent } from 'src/notifications/events/user-added.event';
import { UserSignUpEvent } from 'src/notifications/events/user-signup.event';

describe('Notification Module Integration Tests', () => {
  let app: INestApplication;
  let eventEmitter: EventEmitter2;
  let notificationService: NotificationService;
  let repository: Repository<Notification>;

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot(), NotificationModule],
    })
      .overrideProvider(getRepositoryToken(Notification))
      .useValue(mockRepository)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    eventEmitter = moduleFixture.get<EventEmitter2>(EventEmitter2);
    notificationService =
      moduleFixture.get<NotificationService>(NotificationService);
    repository = moduleFixture.get<Repository<Notification>>(
      getRepositoryToken(Notification),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Event to Notification Flow', () => {
    it('should create notification when notice.created event is emitted', async () => {
      const event: NoticeAgreementCreatedEvent = {
        notice_id: 1,
        user_id: 'user-123',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-456',
        property_name: 'Sunset Villa',
        tenant_name: 'John Doe',
      };

      const mockNotification = {
        id: 'notification-789',
        date: expect.any(String),
        type: NotificationType.NOTICE_AGREEMENT,
        description: `You created a notice agreement for ${event.property_name}.`,
        status: 'Completed',
        property_id: event.property_id,
        user_id: event.user_id,
      };

      mockRepository.create.mockReturnValue(mockNotification);
      mockRepository.save.mockResolvedValue(mockNotification);

      await eventEmitter.emitAsync('notice.created', event);

      // Give time for async processing
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.NOTICE_AGREEMENT,
          property_id: event.property_id,
          user_id: event.user_id,
        }),
      );
      expect(mockRepository.save).toHaveBeenCalled();
    });

    it('should create notification when property.created event is emitted', async () => {
      const event: PropertyCreatedEvent = {
        property_id: 'property-123',
        property_name: 'Ocean View Condo',
        user_id: 'user-456',
      };

      const mockNotification = {
        id: 'notification-999',
        type: NotificationType.PROPERTY_CREATED,
      };

      mockRepository.create.mockReturnValue(mockNotification);
      mockRepository.save.mockResolvedValue(mockNotification);

      await eventEmitter.emitAsync('property.created', event);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.PROPERTY_CREATED,
          description: `New property ${event.property_name} was created.`,
        }),
      );
    });

    it('should create notification when service.created event is emitted', async () => {
      const event: ServiceRequestCreatedEvent = {
        service_request_id: 'request-123',
        user_id: 'user-456',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-789',
        property_name: 'Garden Apartments',
        tenant_name: 'Alice Johnson',
      };

      const mockNotification = {
        id: 'notification-555',
        type: NotificationType.SERVICE_REQUEST,
      };

      mockRepository.create.mockReturnValue(mockNotification);
      mockRepository.save.mockResolvedValue(mockNotification);

      eventEmitter.emit('service.created', event);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.SERVICE_REQUEST,
          status: 'Pending',
          service_request_id: event.service_request_id,
        }),
      );
    });

    it('should create notification when user.added event is emitted', async () => {
      const event: UserAddedToPropertyEvent = {
        user_id: 'user-123',
        property_id: 'property-456',
        property_name: 'Skyline Tower',
        profile_name: 'Emma Davis',
        date: '2025-10-03T10:00:00Z',
      };

      const mockNotification = {
        id: 'notification-666',
        type: NotificationType.USER_ADDED_TO_PROPERTY,
      };

      mockRepository.create.mockReturnValue(mockNotification);
      mockRepository.save.mockResolvedValue(mockNotification);

      eventEmitter.emit('user.added', event);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.USER_ADDED_TO_PROPERTY,
          description: `${event.profile_name} was added to ${event.property_name} `,
        }),
      );
    });

    it('should create notification when user.signup event is emitted', async () => {
      const event: UserSignUpEvent = {
        user_id: 'user-123',
        profile_name: 'Jennifer Wilson',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-456',
      };

      const mockNotification = {
        id: 'notification-777',
        type: NotificationType.USER_SIGNED_UP,
      };

      mockRepository.create.mockReturnValue(mockNotification);
      mockRepository.save.mockResolvedValue(mockNotification);

      eventEmitter.emit('user.signup', event);
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.USER_SIGNED_UP,
          property_id: event.property_id,
        }),
      );
    });
  });

  describe('Multiple Events Handling', () => {
    it('should handle multiple events in sequence', async () => {
      const noticeEvent: NoticeAgreementCreatedEvent = {
        notice_id: 1,
        user_id: 'user-123',
        date: '2025-10-03T10:00:00Z',
        property_id: 'property-456',
        property_name: 'Property A',
        tenant_name: 'Tenant A',
      };

      const propertyEvent: PropertyCreatedEvent = {
        property_id: 'property-789',
        property_name: 'Property B',
        user_id: 'user-123',
      };

      mockRepository.create.mockReturnValue({ id: 'test' });
      mockRepository.save.mockResolvedValue({ id: 'test' });

      await eventEmitter.emitAsync('notice.created', noticeEvent);
      await eventEmitter.emitAsync('property.created', propertyEvent);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mockRepository.save).toHaveBeenCalledTimes(2);
    });

    it('should handle concurrent events', async () => {
      const events = [
        {
          name: 'notice.created',
          data: {
            notice_id: 1,
            user_id: 'user-1',
            date: '2025-10-03',
            property_id: 'prop-1',
            property_name: 'Prop 1',
            tenant_name: 'Tenant 1',
          },
        },
        {
          name: 'property.created',
          data: {
            property_id: 'prop-2',
            property_name: 'Prop 2',
            user_id: 'user-2',
          },
        },
        {
          name: 'user.added',
          data: {
            user_id: 'user-3',
            property_id: 'prop-3',
            property_name: 'Prop 3',
            profile_name: 'User 3',
            date: '2025-10-03',
          },
        },
      ];

      mockRepository.create.mockReturnValue({ id: 'test' });
      mockRepository.save.mockResolvedValue({ id: 'test' });

      await Promise.all(
        events.map((event) => eventEmitter.emitAsync(event.name, event.data)),
      );

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(mockRepository.save).toHaveBeenCalledTimes(3);
    });
  });

  describe('Error Handling in Event Flow', () => {
    it('should handle repository errors gracefully', async () => {
      const event: PropertyCreatedEvent = {
        property_id: 'property-123',
        property_name: 'Error Property',
        user_id: 'user-456',
      };

      mockRepository.create.mockReturnValue({ id: 'test' });
      mockRepository.save.mockRejectedValue(new Error('Database error'));

      // Should not throw error to event emitter
      await expect(
        eventEmitter.emitAsync('property.created', event),
      ).resolves.not.toThrow();
    });

    it('should continue processing other events if one fails', async () => {
      const event1: PropertyCreatedEvent = {
        property_id: 'property-123',
        property_name: 'Property 1',
        user_id: 'user-456',
      };

      const event2: PropertyCreatedEvent = {
        property_id: 'property-456',
        property_name: 'Property 2',
        user_id: 'user-789',
      };

      mockRepository.create.mockReturnValue({ id: 'test' });
      mockRepository.save
        .mockRejectedValueOnce(new Error('First save failed'))
        .mockResolvedValueOnce({ id: 'success' });

      await eventEmitter.emitAsync('property.created', event1);
      await eventEmitter.emitAsync('property.created', event2);

      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(mockRepository.save).toHaveBeenCalledTimes(2);
    });
  });

  describe('Service and Repository Integration', () => {
    it('should properly integrate service methods with repository', async () => {
      const notifications = [
        { id: '1', type: NotificationType.PROPERTY_CREATED },
        { id: '2', type: NotificationType.SERVICE_REQUEST },
      ];

      mockRepository.find.mockResolvedValue(notifications);

      const result = await notificationService.findAll();

      expect(result).toEqual(notifications);
      expect(mockRepository.find).toHaveBeenCalled();
    });

    it('should query notifications with relations', async () => {
      const userId = 'user-123';
      const notifications = [
        {
          id: '1',
          property: { id: 'prop-1', owner_id: userId },
          serviceRequest: null,
        },
      ];

      mockRepository.find.mockResolvedValue(notifications);

      const result = await notificationService.findByUserId(userId);

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { property: { owner_id: userId } },
        relations: ['property', 'serviceRequest'],
        order: { date: 'DESC' },
      });
      expect(result).toEqual(notifications);
    });
  });
});
