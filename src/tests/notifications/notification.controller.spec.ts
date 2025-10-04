import { Test, TestingModule } from '@nestjs/testing';
import { NotificationController } from 'src/notifications/notification.controller';
import { NotificationService } from 'src/notifications/notification.service';
import { CreateNotificationDto } from 'src/notifications/dto/create-notification.dto';
import { Notification } from 'src/notifications/entities/notification.entity';
import { NotificationType } from 'src/notifications/enums/notification-type';
import { Property } from 'src/properties/entities/property.entity';
import { Account } from 'src/users/entities/account.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';

describe('NotificationController', () => {
  let controller: NotificationController;
  let service: NotificationService;

  // Create partial mocks for the related entities
  const mockProperty: Partial<Property> = {
    id: '223e4567-e89b-12d3-a456-426614174000',
    name: 'Mock Property',
  };

  const mockAccount: Partial<Account> = {
    id: '323e4567-e89b-12d3-a456-426614174000',
    profile_name: 'John',
  };

  const mockServiceRequest: Partial<ServiceRequest> = {
    id: '423e4567-e89b-12d3-a456-426614174000',
    description: 'Leaky faucet',
  };

  const mockNotificationService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByPropertyId: jest.fn(),
    findByUserId: jest.fn(),
  };

  const mockNotification: Notification = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    date: '2025-10-03T10:00:00Z',
    type: NotificationType.SERVICE_REQUEST,
    description: 'Test notification',
    status: 'Pending',
    property_id: '223e4567-e89b-12d3-a456-426614174000',
    user_id: '323e4567-e89b-12d3-a456-426614174000',
    service_request_id: '423e4567-e89b-12d3-a456-426614174000',
    property: mockProperty as Property,
    user: mockAccount as Account,
    serviceRequest: mockServiceRequest as ServiceRequest,
    created_at: new Date(),
    updated_at: new Date(),
  };

  const mockRequest = {
    user: {
      id: '323e4567-e89b-12d3-a456-426614174000',
      email: 'test@example.com',
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationController],
      providers: [
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
      ],
    }).compile();

    controller = module.get<NotificationController>(NotificationController);
    service = module.get<NotificationService>(NotificationService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('findByUserId', () => {
    it('should return notifications for authenticated user', async () => {
      const notifications = [mockNotification];
      mockNotificationService.findByUserId.mockResolvedValue(notifications);

      const result = await controller.findByUserId(mockRequest);

      expect(service.findByUserId).toHaveBeenCalledWith(
        '323e4567-e89b-12d3-a456-426614174000',
      );
      expect(result).toEqual(notifications);
    });

    it('should handle empty user id in request', async () => {
      const emptyRequest = { user: { id: undefined } };
      mockNotificationService.findByUserId.mockResolvedValue([]);

      const result = await controller.findByUserId(emptyRequest);

      expect(service.findByUserId).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([]);
    });

    it('should handle request without user object', async () => {
      const noUserRequest = {};
      mockNotificationService.findByUserId.mockResolvedValue([]);

      const result = await controller.findByUserId(noUserRequest);

      expect(service.findByUserId).toHaveBeenCalledWith(undefined);
      expect(result).toEqual([]);
    });

    it('should handle service errors', async () => {
      const error = new Error('Service error');
      mockNotificationService.findByUserId.mockRejectedValue(error);

      await expect(controller.findByUserId(mockRequest)).rejects.toThrow(
        'Service error',
      );
      expect(service.findByUserId).toHaveBeenCalledWith(
        '323e4567-e89b-12d3-a456-426614174000',
      );
    });

    it('should return multiple notifications for user', async () => {
      const notifications = [
        mockNotification,
        {
          ...mockNotification,
          id: '456',
          type: NotificationType.PROPERTY_CREATED,
        },
        { ...mockNotification, id: '789', type: NotificationType.RENT_CREATED },
      ];
      mockNotificationService.findByUserId.mockResolvedValue(notifications);

      const result = await controller.findByUserId(mockRequest);

      expect(result).toHaveLength(3);
      expect(result).toEqual(notifications);
    });
  });

  describe('create', () => {
    it('should create a notification successfully', async () => {
      const dto: CreateNotificationDto = {
        date: '2025-10-03T10:00:00Z',
        type: NotificationType.SERVICE_REQUEST,
        description: 'Test notification',
        status: 'Pending',
        property_id: '223e4567-e89b-12d3-a456-426614174000',
        user_id: '323e4567-e89b-12d3-a456-426614174000',
        service_request_id: '423e4567-e89b-12d3-a456-426614174000',
      };

      mockNotificationService.create.mockResolvedValue(mockNotification);

      const result = await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(mockNotification);
    });

    it('should create notification without optional service_request_id', async () => {
      const dto: CreateNotificationDto = {
        date: '2025-10-03T10:00:00Z',
        type: NotificationType.PROPERTY_CREATED,
        description: 'Property created',
        status: 'Completed',
        property_id: '223e4567-e89b-12d3-a456-426614174000',
        user_id: '323e4567-e89b-12d3-a456-426614174000',
      };

      const notification = {
        ...mockNotification,
        service_request_id: undefined,
      };
      mockNotificationService.create.mockResolvedValue(notification);

      const result = await controller.create(dto);

      expect(service.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(notification);
    });

    it('should handle service errors during creation', async () => {
      const dto: CreateNotificationDto = {
        date: '2025-10-03T10:00:00Z',
        type: NotificationType.SERVICE_REQUEST,
        description: 'Test notification',
        status: 'Pending',
        property_id: '223e4567-e89b-12d3-a456-426614174000',
        user_id: '323e4567-e89b-12d3-a456-426614174000',
      };

      const error = new Error('Creation failed');
      mockNotificationService.create.mockRejectedValue(error);

      await expect(controller.create(dto)).rejects.toThrow('Creation failed');
    });

    it('should create notification with all notification types', async () => {
      const types = [
        NotificationType.SERVICE_REQUEST,
        NotificationType.NOTICE_AGREEMENT,
        NotificationType.RENT_CREATED,
        NotificationType.USER_ADDED_TO_PROPERTY,
        NotificationType.USER_SIGNED_UP,
        NotificationType.LEASE_SIGNED,
        NotificationType.PROPERTY_CREATED,
      ];

      for (const type of types) {
        const dto: CreateNotificationDto = {
          date: '2025-10-03T10:00:00Z',
          type,
          description: `${type} notification`,
          status: 'Completed',
          property_id: '223e4567-e89b-12d3-a456-426614174000',
          user_id: '323e4567-e89b-12d3-a456-426614174000',
        };

        mockNotificationService.create.mockResolvedValue({
          ...mockNotification,
          type,
        });

        const result = await controller.create(dto);

        expect(result.type).toBe(type);
      }
    });
  });

  describe('findAll', () => {
    it('should return all notifications', async () => {
      const notifications = [
        mockNotification,
        { ...mockNotification, id: '456' },
      ];
      mockNotificationService.findAll.mockResolvedValue(notifications);

      const result = await controller.findAll();

      expect(service.findAll).toHaveBeenCalled();
      expect(result).toEqual(notifications);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no notifications exist', async () => {
      mockNotificationService.findAll.mockResolvedValue([]);

      const result = await controller.findAll();

      expect(result).toEqual([]);
    });

    it('should handle service errors', async () => {
      const error = new Error('Database error');
      mockNotificationService.findAll.mockRejectedValue(error);

      await expect(controller.findAll()).rejects.toThrow('Database error');
    });
  });

  describe('findOne', () => {
    it('should find a notification by id', async () => {
      mockNotificationService.findOne.mockResolvedValue(mockNotification);

      const result = await controller.findOne(
        '123e4567-e89b-12d3-a456-426614174000',
      );

      expect(service.findOne).toHaveBeenCalledWith(
        '123e4567-e89b-12d3-a456-426614174000',
      );
      expect(result).toEqual(mockNotification);
    });

    it('should return null when notification not found', async () => {
      mockNotificationService.findOne.mockResolvedValue(null);

      const result = await controller.findOne('non-existent-id');

      expect(service.findOne).toHaveBeenCalledWith('non-existent-id');
      expect(result).toBeNull();
    });

    it('should handle service errors', async () => {
      const error = new Error('Query failed');
      mockNotificationService.findOne.mockRejectedValue(error);

      await expect(
        controller.findOne('123e4567-e89b-12d3-a456-426614174000'),
      ).rejects.toThrow('Query failed');
    });

    it('should handle invalid UUID format', async () => {
      mockNotificationService.findOne.mockResolvedValue(null);

      const result = await controller.findOne('invalid-uuid');

      expect(service.findOne).toHaveBeenCalledWith('invalid-uuid');
      expect(result).toBeNull();
    });
  });

  describe('findByPropertyId', () => {
    it('should find notifications by property_id', async () => {
      const propertyId = '223e4567-e89b-12d3-a456-426614174000';
      const notifications = [mockNotification];
      mockNotificationService.findByPropertyId.mockResolvedValue(notifications);

      const result = await controller.findByPropertyId(propertyId);

      expect(service.findByPropertyId).toHaveBeenCalledWith(propertyId);
      expect(result).toEqual(notifications);
    });

    it('should return empty array when property has no notifications', async () => {
      mockNotificationService.findByPropertyId.mockResolvedValue([]);

      const result = await controller.findByPropertyId('empty-property-id');

      expect(result).toEqual([]);
    });

    it('should return multiple notifications for same property', async () => {
      const propertyId = '223e4567-e89b-12d3-a456-426614174000';
      const notifications = [
        mockNotification,
        {
          ...mockNotification,
          id: '456',
          type: NotificationType.USER_ADDED_TO_PROPERTY,
        },
        {
          ...mockNotification,
          id: '789',
          type: NotificationType.NOTICE_AGREEMENT,
        },
      ];
      mockNotificationService.findByPropertyId.mockResolvedValue(notifications);

      const result = await controller.findByPropertyId(propertyId);

      expect(result).toHaveLength(3);
      expect(result).toEqual(notifications);
    });

    it('should handle service errors', async () => {
      const error = new Error('Property query failed');
      mockNotificationService.findByPropertyId.mockRejectedValue(error);

      await expect(
        controller.findByPropertyId('223e4567-e89b-12d3-a456-426614174000'),
      ).rejects.toThrow('Property query failed');
    });
  });
});
