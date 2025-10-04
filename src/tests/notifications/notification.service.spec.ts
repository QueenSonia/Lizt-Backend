import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationService } from 'src/notifications/notification.service';
import { Notification } from 'src/notifications/entities/notification.entity';
import { CreateNotificationDto } from 'src/notifications/dto/create-notification.dto';
import { NotificationType } from 'src/notifications/enums/notification-type';
import { Property } from 'src/properties/entities/property.entity';
import { Account } from 'src/users/entities/account.entity';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';

describe('NotificationService', () => {
  let service: NotificationService;
  let repository: Repository<Notification>;

  const mockRepository = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
    findOneBy: jest.fn(),
  };

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

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationService,
        {
          provide: getRepositoryToken(Notification),
          useValue: mockRepository,
        },
      ],
    }).compile();

    service = module.get<NotificationService>(NotificationService);
    repository = module.get<Repository<Notification>>(
      getRepositoryToken(Notification),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
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

      mockRepository.create.mockReturnValue(mockNotification);
      mockRepository.save.mockResolvedValue(mockNotification);

      const result = await service.create(dto);

      expect(mockRepository.create).toHaveBeenCalledWith(dto);
      expect(mockRepository.save).toHaveBeenCalledWith(mockNotification);
      expect(result).toEqual(mockNotification);
    });

    it('should create a notification without optional service_request_id', async () => {
      const dto: CreateNotificationDto = {
        date: '2025-10-03T10:00:00Z',
        type: NotificationType.PROPERTY_CREATED,
        description: 'Property created notification',
        status: 'Completed',
        property_id: '223e4567-e89b-12d3-a456-426614174000',
        user_id: '323e4567-e89b-12d3-a456-426614174000',
      };

      const notificationWithoutServiceRequest = {
        ...mockNotification,
        service_request_id: undefined,
      };
      mockRepository.create.mockReturnValue(notificationWithoutServiceRequest);
      mockRepository.save.mockResolvedValue(notificationWithoutServiceRequest);

      const result = await service.create(dto);

      expect(mockRepository.create).toHaveBeenCalledWith(dto);
      expect(result).toEqual(notificationWithoutServiceRequest);
    });

    it('should handle database errors during creation', async () => {
      const dto: CreateNotificationDto = {
        date: '2025-10-03T10:00:00Z',
        type: NotificationType.SERVICE_REQUEST,
        description: 'Test notification',
        status: 'Pending',
        property_id: '223e4567-e89b-12d3-a456-426614174000',
        user_id: '323e4567-e89b-12d3-a456-426614174000',
      };

      const error = new Error('Database error');
      mockRepository.create.mockReturnValue(mockNotification);
      mockRepository.save.mockRejectedValue(error);

      await expect(service.create(dto)).rejects.toThrow('Database error');
    });
  });

  describe('findAll', () => {
    it('should return all notifications', async () => {
      const notifications = [
        mockNotification,
        { ...mockNotification, id: '999' },
      ];
      mockRepository.find.mockResolvedValue(notifications);

      const result = await service.findAll();

      expect(mockRepository.find).toHaveBeenCalledWith();
      expect(result).toEqual(notifications);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no notifications exist', async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await service.findAll();

      expect(result).toEqual([]);
      expect(result).toHaveLength(0);
    });

    it('should handle database errors', async () => {
      const error = new Error('Database connection failed');
      mockRepository.find.mockRejectedValue(error);

      await expect(service.findAll()).rejects.toThrow(
        'Database connection failed',
      );
    });
  });

  describe('findOne', () => {
    it('should find a notification by id', async () => {
      mockRepository.findOneBy.mockResolvedValue(mockNotification);

      const result = await service.findOne(
        '123e4567-e89b-12d3-a456-426614174000',
      );

      expect(mockRepository.findOneBy).toHaveBeenCalledWith({
        id: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result).toEqual(mockNotification);
    });

    it('should return null when notification is not found', async () => {
      mockRepository.findOneBy.mockResolvedValue(null);

      const result = await service.findOne('non-existent-id');

      expect(mockRepository.findOneBy).toHaveBeenCalledWith({
        id: 'non-existent-id',
      });
      expect(result).toBeNull();
    });

    it('should handle database errors', async () => {
      const error = new Error('Query failed');
      mockRepository.findOneBy.mockRejectedValue(error);

      await expect(
        service.findOne('123e4567-e89b-12d3-a456-426614174000'),
      ).rejects.toThrow('Query failed');
    });
  });

  describe('findByPropertyId', () => {
    it('should find notifications by property_id', async () => {
      const propertyId = '223e4567-e89b-12d3-a456-426614174000';
      const notifications = [
        mockNotification,
        { ...mockNotification, id: '456' },
      ];
      mockRepository.find.mockResolvedValue(notifications);

      const result = await service.findByPropertyId(propertyId);

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: { property_id: propertyId },
        relations: ['property'],
      });
      expect(result).toEqual(notifications);
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no notifications exist for property', async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await service.findByPropertyId('non-existent-property');

      expect(result).toEqual([]);
    });

    it('should handle database errors', async () => {
      const error = new Error('Query execution failed');
      mockRepository.find.mockRejectedValue(error);

      await expect(
        service.findByPropertyId('223e4567-e89b-12d3-a456-426614174000'),
      ).rejects.toThrow('Query execution failed');
    });
  });

  describe('findByUserId', () => {
    it('should find notifications by user_id', async () => {
      const userId = '323e4567-e89b-12d3-a456-426614174000';
      const notifications = [mockNotification];
      mockRepository.find.mockResolvedValue(notifications);

      const result = await service.findByUserId(userId);

      expect(mockRepository.find).toHaveBeenCalledWith({
        where: {
          property: {
            owner_id: userId,
          },
        },
        relations: ['property', 'serviceRequest'],
        order: {
          date: 'DESC',
        },
      });
      expect(result).toEqual(notifications);
    });

    it('should return notifications ordered by date DESC', async () => {
      const userId = '323e4567-e89b-12d3-a456-426614174000';
      const notification1 = {
        ...mockNotification,
        date: '2025-10-01T10:00:00Z',
      };
      const notification2 = {
        ...mockNotification,
        id: '789',
        date: '2025-10-03T10:00:00Z',
      };
      const notifications = [notification2, notification1];
      mockRepository.find.mockResolvedValue(notifications);

      const result = await service.findByUserId(userId);

      expect(result[0].date).toBe('2025-10-03T10:00:00Z');
      expect(mockRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          order: { date: 'DESC' },
        }),
      );
    });

    it('should return empty array when user has no notifications', async () => {
      mockRepository.find.mockResolvedValue([]);

      const result = await service.findByUserId('user-with-no-notifications');

      expect(result).toEqual([]);
    });

    it('should handle database errors', async () => {
      const error = new Error('Join query failed');
      mockRepository.find.mockRejectedValue(error);

      await expect(
        service.findByUserId('323e4567-e89b-12d3-a456-426614174000'),
      ).rejects.toThrow('Join query failed');
    });

    it('should include property and serviceRequest relations', async () => {
      const userId = '323e4567-e89b-12d3-a456-426614174000';
      mockRepository.find.mockResolvedValue([mockNotification]);

      await service.findByUserId(userId);

      expect(mockRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: ['property', 'serviceRequest'],
        }),
      );
    });
  });
});
