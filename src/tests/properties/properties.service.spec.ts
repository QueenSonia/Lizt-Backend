import { Test, TestingModule } from '@nestjs/testing';
import { PropertiesService } from 'src/properties/properties.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Property } from 'src/properties/entities/property.entity';
import { PropertyGroup } from 'src/properties/entities/property-group.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { UsersService } from 'src/users/users.service';
import { RentsService } from 'src/rents/rents.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';
import { HttpException, HttpStatus, NotFoundException } from '@nestjs/common';
import {
  CreatePropertyDto,
  PropertyStatusEnum,
  TenantStatusEnum,
} from 'src/properties/dto/create-property.dto';
import {
  MoveTenantInDto,
  MoveTenantOutDto,
} from 'src/properties/dto/move-tenant.dto';
import { CreatePropertyGroupDto } from 'src/properties/dto/create-property-group.dto';
import { AssignTenantDto } from 'src/properties/dto/assign-tenant.dto';
import { DateService } from 'src/utils/date.helper';
import { Rent } from 'src/rents/entities/rent.entity';
import { PropertyHistory } from 'src/property-history/entities/property-history.entity';

describe('PropertiesService', () => {
  let service: PropertiesService;
  let propertyRepository: Repository<Property>;
  let propertyGroupRepository: Repository<PropertyGroup>;
  let userService: UsersService;
  let rentService: RentsService;
  let eventEmitter: EventEmitter2;
  let dataSource: DataSource;

  const mockPropertyRepository = {
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockPropertyGroupRepository = {
    save: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
  };

  const mockUserService = {
    getAccountById: jest.fn(),
    updateUserById: jest.fn(),
    sendPropertiesNotification: jest.fn(),
  };

  const mockRentService = {
    findActiveRent: jest.fn(),
    updateRentById: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
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
      delete: jest.fn(),
    },
  };

  const mockDataSource = {
    createQueryRunner: jest.fn(() => mockQueryRunner),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropertiesService,
        {
          provide: getRepositoryToken(Property),
          useValue: mockPropertyRepository,
        },
        {
          provide: getRepositoryToken(PropertyGroup),
          useValue: mockPropertyGroupRepository,
        },
        {
          provide: UsersService,
          useValue: mockUserService,
        },
        {
          provide: RentsService,
          useValue: mockRentService,
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
    propertyRepository = module.get<Repository<Property>>(
      getRepositoryToken(Property),
    );
    propertyGroupRepository = module.get<Repository<PropertyGroup>>(
      getRepositoryToken(PropertyGroup),
    );
    userService = module.get<UsersService>(UsersService);
    rentService = module.get<RentsService>(RentsService);
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
    dataSource = module.get<DataSource>(DataSource);

    jest.clearAllMocks();
  });

  describe('createProperty', () => {
    it('should create a property successfully', async () => {
      const createPropertyDto: CreatePropertyDto = {
        name: 'Test Property',
        location: 'Lagos',
        description: 'A test property',
        property_type: 'Duplex',
        no_of_bedrooms: 3,
      };

      const savedProperty = {
        id: 'property-id',
        ...createPropertyDto,
        owner_id: 'owner-id',
      };

      const propertyWithOwner = {
        ...savedProperty,
        owner: {
          user: {
            phone_number: '+2348012345678',
          },
        },
      };

      mockPropertyRepository.save.mockResolvedValue(savedProperty);
      jest
        .spyOn(service, 'getPropertyById')
        .mockResolvedValue(propertyWithOwner);
      mockUserService.sendPropertiesNotification.mockResolvedValue(undefined);

      const result = await service.createProperty(createPropertyDto);

      expect(mockPropertyRepository.save).toHaveBeenCalledWith(
        createPropertyDto,
      );
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('property.created', {
        property_id: savedProperty.id,
        property_name: savedProperty.name,
        user_id: savedProperty.owner_id,
      });
      expect(mockUserService.sendPropertiesNotification).toHaveBeenCalled();
      expect(result).toEqual(savedProperty);
    });
  });

  describe('getAllProperties', () => {
    it('should return paginated properties', async () => {
      const queryParams = {
        page: 1,
        size: 10,
      };

      const properties = [
        { id: 'prop-1', name: 'Property 1' },
        { id: 'prop-2', name: 'Property 2' },
      ];

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([properties, 2]),
      };

      mockPropertyRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );

      const result = await service.getAllProperties(queryParams);

      expect(result).toEqual({
        properties,
        pagination: {
          totalRows: 2,
          perPage: 10,
          currentPage: 1,
          totalPages: 1,
          hasNextPage: false,
        },
      });
    });

    it('should apply sorting by rent when specified', async () => {
      const queryParams = {
        page: 1,
        size: 10,
        sort_by: 'rent',
        sort_order: 'desc',
      };

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
      };

      mockPropertyRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );

      await service.getAllProperties(queryParams);

      expect(mockQueryBuilder.orderBy).toHaveBeenCalledWith(
        'rents.rental_price',
        'DESC',
      );
    });
  });

  describe('getVacantProperty', () => {
    it('should return vacant properties for an owner', async () => {
      const query = { owner_id: 'owner-id' };
      const vacantProperties = [
        { id: 'prop-1', property_status: PropertyStatusEnum.VACANT },
      ];

      mockPropertyRepository.find.mockResolvedValue(vacantProperties);

      const result = await service.getVacantProperty(query);

      expect(mockPropertyRepository.find).toHaveBeenCalledWith({
        where: {
          property_status: PropertyStatusEnum.VACANT,
          ...query,
        },
        relations: ['property_tenants', 'rents', 'rents.tenant'],
      });
      expect(result).toEqual(vacantProperties);
    });
  });

  describe('getPropertyById', () => {
    it('should return a property by id', async () => {
      const propertyId = 'property-id';
      const property = {
        id: propertyId,
        name: 'Test Property',
      };

      mockPropertyRepository.findOne.mockResolvedValue(property);

      const result = await service.getPropertyById(propertyId);

      expect(mockPropertyRepository.findOne).toHaveBeenCalledWith({
        where: { id: propertyId },
        relations: [
          'rents',
          'property_tenants',
          'property_tenants.tenant',
          'property_tenants.tenant.user',
          'owner',
          'owner.user',
        ],
      });
      expect(result).toEqual(property);
    });

    it('should throw HttpException when property not found', async () => {
      const propertyId = 'non-existent-id';
      mockPropertyRepository.findOne.mockResolvedValue(null);

      await expect(service.getPropertyById(propertyId)).rejects.toThrow(
        new HttpException(
          `Property with id: ${propertyId} not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
    });
  });

  describe('updatePropertyById', () => {
    it('should update property without active rent', async () => {
      const propertyId = 'property-id';
      const updateData = {
        name: 'Updated Property',
        location: 'Abuja',
        no_of_bedrooms: 4,
      };

      mockRentService.findActiveRent.mockResolvedValue(null);
      mockPropertyRepository.update.mockResolvedValue({ affected: 1 });

      const result = await service.updatePropertyById(propertyId, updateData);

      expect(mockRentService.findActiveRent).toHaveBeenCalledWith({
        property_id: propertyId,
      });
      expect(mockPropertyRepository.update).toHaveBeenCalledWith(propertyId, {
        name: updateData.name,
        location: updateData.location,
        no_of_bedrooms: updateData.no_of_bedrooms,
      });
      expect(result).toEqual({ affected: 1 });
    });

    it('should update property with active rent and tenant info', async () => {
      const propertyId = 'property-id';
      const updateData = {
        name: 'Updated Property',
        location: 'Abuja',
        no_of_bedrooms: 4,
        first_name: 'John',
        last_name: 'Doe',
        phone_number: '08012345678',
        lease_end_date: '2025-12-31',
        rental_price: 500000,
        service_charge: 50000,
        security_deposit: 100000,
        occupancy_status: PropertyStatusEnum.NOT_VACANT,
      };

      const activeRent = {
        id: 'rent-id',
        tenant_id: 'tenant-id',
      };

      mockRentService.findActiveRent.mockResolvedValue(activeRent);
      mockUserService.updateUserById.mockResolvedValue(undefined);
      mockRentService.updateRentById.mockResolvedValue(undefined);
      mockPropertyRepository.update.mockResolvedValue({ affected: 1 });

      await service.updatePropertyById(propertyId, updateData);

      expect(mockUserService.updateUserById).toHaveBeenCalledWith(
        activeRent.tenant_id,
        {
          first_name: updateData.first_name,
          last_name: updateData.last_name,
          phone_number: updateData.phone_number,
        },
      );
      expect(mockRentService.updateRentById).toHaveBeenCalled();
      expect(mockPropertyRepository.update).toHaveBeenCalled();
    });
  });

  describe('deletePropertyById', () => {
    it('should delete a vacant property', async () => {
      const propertyId = 'property-id';
      const property = {
        id: propertyId,
        property_status: PropertyStatusEnum.VACANT,
      };

      mockPropertyRepository.findOne.mockResolvedValue(property);
      mockPropertyRepository.delete.mockResolvedValue({ affected: 1 });

      const result = await service.deletePropertyById(propertyId);

      expect(mockPropertyRepository.delete).toHaveBeenCalledWith(propertyId);
      expect(result).toEqual({ affected: 1 });
    });

    it('should throw error when trying to delete non-vacant property', async () => {
      const propertyId = 'property-id';
      const property = {
        id: propertyId,
        property_status: PropertyStatusEnum.NOT_VACANT,
      };

      mockPropertyRepository.findOne.mockResolvedValue(property);

      await expect(service.deletePropertyById(propertyId)).rejects.toThrow(
        new HttpException(
          'Cannot delete property that is not vacant',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });
  });

  describe('getAdminDashboardStats', () => {
    it('should return dashboard statistics', async () => {
      const userId = 'user-id';
      const stats = {
        total_properties: '10',
        total_tenants: '8',
        due_tenants: '2',
        unresolved_requests: '3',
      };

      const mockQueryBuilder = {
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        setParameters: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(stats),
      };

      mockPropertyRepository.createQueryBuilder.mockReturnValue(
        mockQueryBuilder,
      );

      const result = await service.getAdminDashboardStats(userId);

      expect(result).toEqual({
        total_properties: 10,
        total_tenants: 8,
        due_tenants: 2,
        unresolved_requests: 3,
      });
    });
  });

  describe('moveTenantIn', () => {
    it('should move tenant in successfully', async () => {
      const moveInData: MoveTenantInDto = {
        property_id: 'property-id',
        tenant_id: 'tenant-id',
        move_in_date: '2025-01-01',
      };

      const property = {
        id: 'property-id',
        rental_price: 500000,
      };

      jest.spyOn(DateService, 'isValidFormat_YYYY_MM_DD').mockReturnValue(true);
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(property)
        .mockResolvedValueOnce(null);
      mockQueryRunner.manager.save.mockResolvedValue({
        id: 'new-tenant-record',
      });

      const result = await service.moveTenantIn(moveInData);

      expect(mockQueryRunner.startTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        Property,
        moveInData.property_id,
        { property_status: PropertyStatusEnum.NOT_VACANT },
      );
    });

    it('should throw error for invalid date format', async () => {
      const moveInData: MoveTenantInDto = {
        property_id: 'property-id',
        tenant_id: 'tenant-id',
        move_in_date: 'invalid-date',
      };

      jest
        .spyOn(DateService, 'isValidFormat_YYYY_MM_DD')
        .mockReturnValue(false);

      await expect(service.moveTenantIn(moveInData)).rejects.toThrow(
        new HttpException(
          'Invalid date format. Use YYYY-MM-DD',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });

    it('should throw error if tenant already assigned', async () => {
      const moveInData: MoveTenantInDto = {
        property_id: 'property-id',
        tenant_id: 'tenant-id',
        move_in_date: '2025-01-01',
      };

      const property = { id: 'property-id' };
      const existingTenant = { id: 'existing-tenant-record' };

      jest.spyOn(DateService, 'isValidFormat_YYYY_MM_DD').mockReturnValue(true);
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(property)
        .mockResolvedValueOnce(existingTenant);

      await expect(service.moveTenantIn(moveInData)).rejects.toThrow();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });

  describe('moveTenantOut', () => {
    it('should move tenant out successfully', async () => {
      const moveOutData: MoveTenantOutDto = {
        property_id: 'property-id',
        tenant_id: 'tenant-id',
        move_out_date: '2025-12-31',
        move_out_reason: 'Lease ended',
      };

      const propertyTenant = {
        id: 'property-tenant-id',
        status: TenantStatusEnum.ACTIVE,
      };

      const propertyHistory = {
        id: 'history-id',
        property_id: 'property-id',
        tenant_id: 'tenant-id',
      };

      jest.spyOn(DateService, 'isValidFormat_YYYY_MM_DD').mockReturnValue(true);
      mockQueryRunner.manager.findOne
        .mockResolvedValueOnce(propertyTenant)
        .mockResolvedValueOnce(propertyHistory);
      mockQueryRunner.manager.save.mockResolvedValue(propertyHistory);

      const result = await service.moveTenantOut(moveOutData);

      expect(mockQueryRunner.manager.delete).toHaveBeenCalledWith(
        PropertyTenant,
        {
          property_id: moveOutData.property_id,
          tenant_id: moveOutData.tenant_id,
        },
      );
      expect(mockQueryRunner.manager.update).toHaveBeenCalledWith(
        Property,
        moveOutData.property_id,
        { property_status: PropertyStatusEnum.VACANT },
      );
      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
    });
  });

  describe('createPropertyGroup', () => {
    it('should create a property group successfully', async () => {
      const createGroupDto: CreatePropertyGroupDto = {
        name: 'Luxury Properties',
        property_ids: ['prop-1', 'prop-2'],
      };
      const ownerId = 'owner-id';

      const properties = [
        { id: 'prop-1', owner_id: ownerId },
        { id: 'prop-2', owner_id: ownerId },
      ];

      mockPropertyRepository.find.mockResolvedValue(properties);
      mockPropertyGroupRepository.save.mockResolvedValue({
        id: 'group-id',
        ...createGroupDto,
        owner_id: ownerId,
      });

      const result = await service.createPropertyGroup(createGroupDto, ownerId);

      expect(mockPropertyRepository.find).toHaveBeenCalledWith({
        where: {
          id: expect.anything(),
          owner_id: ownerId,
        },
      });
      expect(result).toHaveProperty('id', 'group-id');
    });

    it('should throw error if properties do not belong to owner', async () => {
      const createGroupDto: CreatePropertyGroupDto = {
        name: 'Luxury Properties',
        property_ids: ['prop-1', 'prop-2'],
      };
      const ownerId = 'owner-id';

      mockPropertyRepository.find.mockResolvedValue([{ id: 'prop-1' }]);

      await expect(
        service.createPropertyGroup(createGroupDto, ownerId),
      ).rejects.toThrow(
        new HttpException(
          'Some properties do not exist or do not belong to you',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });
  });

  describe('assignTenant', () => {
    it('should assign tenant to property successfully', async () => {
      const propertyId = 'property-id';
      const assignTenantDto: AssignTenantDto = {
        tenant_id: 'tenant-id',
        rental_price: 500000,
        service_charge: 50000,
        security_deposit: 100000,
        lease_start_date: '2025-01-01',
        lease_end_date: '2025-12-31',
        rent_status: 'active',
      };

      const property = { id: propertyId };
      const tenant = { id: 'tenant-id' };

      mockQueryRunner.manager.findOne.mockResolvedValue(property);
      mockUserService.getAccountById.mockResolvedValue(tenant);
      mockQueryRunner.manager.save.mockResolvedValue(undefined);

      const result = await service.assignTenant(propertyId, assignTenantDto);

      expect(mockQueryRunner.commitTransaction).toHaveBeenCalled();
      expect(result).toEqual({ message: 'Tenant Added Successfully' });
    });

    it('should throw error if property not found', async () => {
      const propertyId = 'non-existent-id';
      const assignTenantDto: AssignTenantDto = {
        tenant_id: 'tenant-id',
        rental_price: 500000,
        service_charge: 50000,
        security_deposit: 100000,
        lease_start_date: '2025-01-01',
        lease_end_date: '2025-12-31',
        rent_status: 'active',
      };

      mockQueryRunner.manager.findOne.mockResolvedValue(null);

      await expect(
        service.assignTenant(propertyId, assignTenantDto),
      ).rejects.toThrow();
      expect(mockQueryRunner.rollbackTransaction).toHaveBeenCalled();
    });
  });
});
