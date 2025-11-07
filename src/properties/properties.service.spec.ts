import { Test, TestingModule } from '@nestjs/testing';
import { PropertiesService } from './properties.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Property } from './entities/property.entity';
import { PropertyTenant } from './entities/property-tenants.entity';
import { PropertyGroup } from './entities/property-group.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';
import { UsersService } from 'src/users/users.service';
import { RentsService } from 'src/rents/rents.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { HttpException, HttpStatus } from '@nestjs/common';
import { PropertyStatusEnum } from './dto/create-property.dto';

describe('PropertiesService', () => {
  let service: PropertiesService;
  let propertyRepository: any;
  let propertyHistoryRepository: any;

  const mockPropertyRepository = {
    findOneBy: jest.fn(),
    softDelete: jest.fn(),
  };

  const mockPropertyHistoryRepository = {
    count: jest.fn(),
  };

  const mockPropertyTenantRepository = {};
  const mockPropertyGroupRepository = {};
  const mockUsersService = {};
  const mockRentsService = {};
  const mockEventEmitter = {};
  const mockDataSource = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropertiesService,
        {
          provide: getRepositoryToken(Property),
          useValue: mockPropertyRepository,
        },
        {
          provide: getRepositoryToken(PropertyTenant),
          useValue: mockPropertyTenantRepository,
        },
        {
          provide: getRepositoryToken(PropertyGroup),
          useValue: mockPropertyGroupRepository,
        },
        {
          provide: getRepositoryToken(PropertyHistory),
          useValue: mockPropertyHistoryRepository,
        },
        {
          provide: UsersService,
          useValue: mockUsersService,
        },
        {
          provide: RentsService,
          useValue: mockRentsService,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<PropertiesService>(PropertiesService);
    propertyRepository = module.get(getRepositoryToken(Property));
    propertyHistoryRepository = module.get(getRepositoryToken(PropertyHistory));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('deletePropertyById', () => {
    const propertyId = 'test-property-id';
    const ownerId = 'test-owner-id';

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should throw NOT_FOUND when property does not exist', async () => {
      propertyRepository.findOneBy.mockResolvedValue(null);

      await expect(
        service.deletePropertyById(propertyId, ownerId),
      ).rejects.toThrow(
        new HttpException('Property not found', HttpStatus.NOT_FOUND),
      );
    });

    it('should throw BAD_REQUEST when property is occupied', async () => {
      const occupiedProperty = {
        id: propertyId,
        owner_id: ownerId,
        property_status: PropertyStatusEnum.OCCUPIED,
      };
      propertyRepository.findOneBy.mockResolvedValue(occupiedProperty);

      await expect(
        service.deletePropertyById(propertyId, ownerId),
      ).rejects.toThrow(
        new HttpException(
          'Cannot delete property that is currently occupied. Please end the tenancy first.',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should throw BAD_REQUEST when property is inactive', async () => {
      const inactiveProperty = {
        id: propertyId,
        owner_id: ownerId,
        property_status: PropertyStatusEnum.INACTIVE,
      };
      propertyRepository.findOneBy.mockResolvedValue(inactiveProperty);

      await expect(
        service.deletePropertyById(propertyId, ownerId),
      ).rejects.toThrow(
        new HttpException(
          'Cannot delete property that is deactivated. Please reactivate the property first.',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should throw BAD_REQUEST when property has tenancy history', async () => {
      const vacantProperty = {
        id: propertyId,
        owner_id: ownerId,
        property_status: PropertyStatusEnum.VACANT,
      };
      propertyRepository.findOneBy.mockResolvedValue(vacantProperty);
      propertyHistoryRepository.count.mockResolvedValue(1); // Has history

      await expect(
        service.deletePropertyById(propertyId, ownerId),
      ).rejects.toThrow(
        new HttpException(
          'Cannot delete property with existing tenancy history. Properties that have been inhabited cannot be deleted.',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should successfully delete vacant property with no history', async () => {
      const vacantProperty = {
        id: propertyId,
        owner_id: ownerId,
        property_status: PropertyStatusEnum.VACANT,
      };
      propertyRepository.findOneBy.mockResolvedValue(vacantProperty);
      propertyHistoryRepository.count.mockResolvedValue(0); // No history
      propertyRepository.softDelete.mockResolvedValue({ affected: 1 });

      await expect(
        service.deletePropertyById(propertyId, ownerId),
      ).resolves.not.toThrow();

      expect(propertyRepository.softDelete).toHaveBeenCalledWith(propertyId);
    });
  });

  describe('assignTenant', () => {
    const propertyId = 'test-property-id';
    const assignTenantDto = {
      tenant_id: 'test-tenant-id',
      lease_start_date: '2024-01-01',
      lease_end_date: '2024-12-31',
      rental_price: 100000,
      security_deposit: 50000,
      service_charge: 10000,
      payment_frequency: 'Monthly',
      rent_status: 'active',
    };

    const mockQueryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      rollbackTransaction: jest.fn(),
      release: jest.fn(),
      manager: {
        findOne: jest.fn(),
        save: jest.fn(),
        update: jest.fn(),
      },
    };

    const mockDataSource = {
      createQueryRunner: jest.fn(() => mockQueryRunner),
    };

    beforeEach(() => {
      jest.clearAllMocks();
      // Update the service to use the mock data source
      (service as any).dataSource = mockDataSource;
      (service as any).userService = {
        getAccountById: jest.fn().mockResolvedValue({ id: 'test-tenant-id' }),
      };
    });

    it('should throw NOT_FOUND when property does not exist', async () => {
      mockQueryRunner.manager.findOne.mockResolvedValue(null);

      await expect(
        service.assignTenant(propertyId, assignTenantDto),
      ).rejects.toThrow(
        new HttpException(
          `Property with id: ${propertyId} not found`,
          HttpStatus.NOT_FOUND,
        ),
      );

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should throw BAD_REQUEST when property is inactive', async () => {
      const inactiveProperty = {
        id: propertyId,
        property_status: PropertyStatusEnum.INACTIVE,
      };
      mockQueryRunner.manager.findOne.mockResolvedValue(inactiveProperty);

      await expect(
        service.assignTenant(propertyId, assignTenantDto),
      ).rejects.toThrow(
        new HttpException(
          'Cannot assign tenant to inactive property. Please reactivate the property first.',
          HttpStatus.BAD_REQUEST,
        ),
      );

      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });

    it('should successfully assign tenant to vacant property', async () => {
      const vacantProperty = {
        id: propertyId,
        property_status: PropertyStatusEnum.VACANT,
      };
      mockQueryRunner.manager.findOne.mockResolvedValue(vacantProperty);
      mockQueryRunner.manager.save.mockResolvedValue({});
      mockQueryRunner.manager.update.mockResolvedValue({});

      const result = await service.assignTenant(propertyId, assignTenantDto);

      expect(result).toEqual({ message: 'Tenant Added Successfully' });
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.release).toHaveBeenCalled();
    });
  });
});
