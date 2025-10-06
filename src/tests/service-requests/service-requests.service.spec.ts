import { Test, TestingModule } from '@nestjs/testing';
import { ServiceRequestsService } from 'src/service-requests/service-requests.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServiceRequest } from 'src/service-requests/entities/service-request.entity';
import { PropertyTenant } from 'src/properties/entities/property-tenants.entity';
import { TeamMember } from 'src/users/entities/team-member.entity';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { HttpException, HttpStatus } from '@nestjs/common';
import { ServiceRequestStatusEnum } from 'src/service-requests/dto/create-service-request.dto';
import { RolesEnum } from 'src/base.entity';
import { UpdateServiceRequestResponseDto } from 'src/service-requests/dto/update-service-request.dto';

describe('ServiceRequestsService', () => {
  let service: ServiceRequestsService;
  let serviceRequestRepository: Repository<ServiceRequest>;
  let propertyTenantRepository: Repository<PropertyTenant>;
  let teamMemberRepository: Repository<TeamMember>;
  let eventEmitter: EventEmitter2;

  const mockServiceRequestRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
    findAndCount: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const mockPropertyTenantRepository = {
    findOne: jest.fn(),
  };

  const mockTeamMemberRepository = {
    find: jest.fn(),
  };

  const mockEventEmitter = {
    emit: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceRequestsService,
        {
          provide: getRepositoryToken(ServiceRequest),
          useValue: mockServiceRequestRepository,
        },
        {
          provide: getRepositoryToken(PropertyTenant),
          useValue: mockPropertyTenantRepository,
        },
        {
          provide: getRepositoryToken(TeamMember),
          useValue: mockTeamMemberRepository,
        },
        {
          provide: EventEmitter2,
          useValue: mockEventEmitter,
        },
      ],
    }).compile();

    service = module.get<ServiceRequestsService>(ServiceRequestsService);
    serviceRequestRepository = module.get<Repository<ServiceRequest>>(
      getRepositoryToken(ServiceRequest),
    );
    propertyTenantRepository = module.get<Repository<PropertyTenant>>(
      getRepositoryToken(PropertyTenant),
    );
    teamMemberRepository = module.get<Repository<TeamMember>>(
      getRepositoryToken(TeamMember),
    );
    eventEmitter = module.get<EventEmitter2>(EventEmitter2);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createServiceRequest', () => {
    const mockTenantId = 'tenant-uuid';
    const mockPropertyId = 'property-uuid';
    const mockOwnerId = 'owner-uuid';

    const createDto = {
      tenant_id: mockTenantId,
      text: 'Water leak in bathroom',
    };

    const mockPropertyTenant = {
      id: 'property-tenant-uuid',
      tenant_id: mockTenantId,
      property_id: mockPropertyId,
      tenant: {
        id: mockTenantId,
        profile_name: 'John Doe',
      },
      property: {
        id: mockPropertyId,
        name: 'Test Property',
        location: 'Test Location',
        owner_id: mockOwnerId,
      },
    };

    const mockFacilityManagers = [
      {
        id: 'manager-1',
        account: {
          user: {
            phone_number: '+2348012345678',
            first_name: 'jane',
          },
        },
      },
      {
        id: 'manager-2',
        account: {
          user: {
            phone_number: '+2348087654321',
            first_name: 'bob',
          },
        },
      },
    ];

    it('should create a service request successfully', async () => {
      mockPropertyTenantRepository.findOne.mockResolvedValue(
        mockPropertyTenant,
      );
      mockTeamMemberRepository.find.mockResolvedValue(mockFacilityManagers);

      const mockCreatedRequest = {
        id: 'request-uuid',
        request_id: 'SR-123456',
        tenant_id: mockTenantId,
        property_id: mockPropertyId,
        description: createDto.text,
        status: ServiceRequestStatusEnum.PENDING,
      };

      mockServiceRequestRepository.create.mockReturnValue(mockCreatedRequest);
      mockServiceRequestRepository.save.mockResolvedValue(mockCreatedRequest);

      const result = await service.createServiceRequest(createDto);

      expect(mockPropertyTenantRepository.findOne).toHaveBeenCalledWith({
        where: { tenant_id: mockTenantId },
        relations: ['tenant', 'property'],
      });

      expect(mockTeamMemberRepository.find).toHaveBeenCalledWith({
        where: {
          team: { creatorId: mockOwnerId },
          role: RolesEnum.FACILITY_MANAGER,
        },
        relations: ['team', 'account', 'account.user'],
      });

      expect(mockServiceRequestRepository.save).toHaveBeenCalled();
      expect(mockEventEmitter.emit).toHaveBeenCalledWith('service.created', {
        user_id: mockTenantId,
        property_id: mockPropertyId,
        tenant_name: 'John Doe',
        property_name: 'Test Property',
      });

      expect(result).toHaveProperty('facility_managers');
      expect(result.facility_managers).toHaveLength(2);
      expect(result.property_name).toBe('Test Property');
    });

    it('should throw error if tenant is not in property', async () => {
      mockPropertyTenantRepository.findOne.mockResolvedValue(null);

      await expect(service.createServiceRequest(createDto)).rejects.toThrow(
        new HttpException(
          'You are not currently renting this property',
          HttpStatus.UNPROCESSABLE_ENTITY,
        ),
      );
    });

    it('should throw error if no facility managers found', async () => {
      mockPropertyTenantRepository.findOne.mockResolvedValue(
        mockPropertyTenant,
      );
      mockTeamMemberRepository.find.mockResolvedValue([]);

      await expect(service.createServiceRequest(createDto)).rejects.toThrow(
        new HttpException(
          'No facility manager assigned to this property yet',
          HttpStatus.BAD_REQUEST,
        ),
      );
    });
  });

  describe('getAllServiceRequests', () => {
    const mockUserId = 'user-uuid';
    const mockQueryParams = {
      page: 1,
      size: 10,
      status: 'pending',
    };

    it('should return paginated service requests', async () => {
      const mockRequests = [
        {
          id: 'request-1',
          request_id: 'SR-001',
          status: ServiceRequestStatusEnum.PENDING,
        },
        {
          id: 'request-2',
          request_id: 'SR-002',
          status: ServiceRequestStatusEnum.IN_PROGRESS,
        },
      ];

      mockServiceRequestRepository.findAndCount.mockResolvedValue([
        mockRequests,
        2,
      ]);

      const result = await service.getAllServiceRequests(
        mockUserId,
        mockQueryParams,
      );

      expect(result).toHaveProperty('service_requests');
      expect(result).toHaveProperty('pagination');
      expect(result.service_requests).toHaveLength(2);
      expect(result.pagination.totalRows).toBe(2);
      expect(result.pagination.currentPage).toBe(1);
      expect(result.pagination.perPage).toBe(10);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('should handle empty results', async () => {
      mockServiceRequestRepository.findAndCount.mockResolvedValue([[], 0]);

      const result = await service.getAllServiceRequests(
        mockUserId,
        mockQueryParams,
      );

      expect(result.service_requests).toHaveLength(0);
      expect(result.pagination.totalRows).toBe(0);
    });
  });

  describe('getServiceRequestById', () => {
    const mockRequestId = 'request-uuid';

    it('should return a service request by id', async () => {
      const mockRequest = {
        id: mockRequestId,
        request_id: 'SR-001',
        status: ServiceRequestStatusEnum.PENDING,
      };

      mockServiceRequestRepository.findOne.mockResolvedValue(mockRequest);

      const result = await service.getServiceRequestById(mockRequestId);

      expect(mockServiceRequestRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockRequestId },
        relations: ['tenant', 'property'],
      });
      expect(result).toEqual(mockRequest);
    });

    it('should throw error if request not found', async () => {
      mockServiceRequestRepository.findOne.mockResolvedValue(null);

      await expect(
        service.getServiceRequestById(mockRequestId),
      ).rejects.toThrow(
        new HttpException(
          `Service request with id: ${mockRequestId} not found`,
          HttpStatus.NOT_FOUND,
        ),
      );
    });
  });

  describe('getServiceRequestByTenant', () => {
    const mockTenantId = 'tenant-uuid';

    it('should return service requests for a tenant with default statuses', async () => {
      const mockRequests = [
        { id: '1', status: ServiceRequestStatusEnum.PENDING },
        { id: '2', status: ServiceRequestStatusEnum.IN_PROGRESS },
      ];

      mockServiceRequestRepository.find.mockResolvedValue(mockRequests);

      const result = await service.getServiceRequestByTenant(mockTenantId);

      expect(result).toHaveLength(2);
      expect(mockServiceRequestRepository.find).toHaveBeenCalled();
    });

    it('should filter by specific status', async () => {
      const mockRequests = [
        { id: '1', status: ServiceRequestStatusEnum.PENDING },
      ];

      mockServiceRequestRepository.find.mockResolvedValue(mockRequests);

      const result = await service.getServiceRequestByTenant(
        mockTenantId,
        'pending',
      );

      expect(result).toHaveLength(1);
    });
  });

  describe('updateServiceRequestById', () => {
    const mockRequestId = 'request-uuid';
    const updateDto: UpdateServiceRequestResponseDto = {
      tenant_name: 'John Doe',
      property_name: 'Luxury Apartment',
      status: ServiceRequestStatusEnum.IN_PROGRESS,
      issue_category: 'Carpentry',
      date_reported: new Date('2024-03-21'),
      resolution_date: new Date('2024-03-25'),
      description: 'The roof is leaking during heavy rainfall.',
      issue_images: [
        'https://example.com/images/leak1.jpg',
        'https://example.com/images/leak2.jpg',
      ],
      tenant_id: '90b7f325-be27-45a7-9688-fa49630cac8f',
      property_id: 'b5c4f210-9d2c-47ef-a928-39b9e1c23ab1',
    };

    it('should update a service request', async () => {
      const updateResult = { affected: 1, raw: [], generatedMaps: [] };
      mockServiceRequestRepository.update.mockResolvedValue(updateResult);

      const result = await service.updateServiceRequestById(
        mockRequestId,
        updateDto,
      );

      expect(mockServiceRequestRepository.update).toHaveBeenCalledWith(
        mockRequestId,
        updateDto,
      );
      expect(result).toEqual(updateResult);
    });
  });

  describe('deleteServiceRequestById', () => {
    const mockRequestId = 'request-uuid';

    it('should delete a service request', async () => {
      const deleteResult = { affected: 1, raw: [] };
      mockServiceRequestRepository.delete.mockResolvedValue(deleteResult);

      const result = await service.deleteServiceRequestById(mockRequestId);

      expect(mockServiceRequestRepository.delete).toHaveBeenCalledWith(
        mockRequestId,
      );
      expect(result).toEqual(deleteResult);
    });
  });

  describe('getPendingAndUrgentRequests', () => {
    const mockOwnerId = 'owner-uuid';
    const mockQueryParams = { page: 1, size: 10 };

    it('should return pending and urgent requests', async () => {
      const mockRequests = [
        { id: '1', status: ServiceRequestStatusEnum.PENDING },
        { id: '2', status: ServiceRequestStatusEnum.URGENT },
      ];

      mockServiceRequestRepository.findAndCount.mockResolvedValue([
        mockRequests,
        2,
      ]);

      const result = await service.getPendingAndUrgentRequests(
        mockQueryParams,
        mockOwnerId,
      );

      expect(result.service_requests).toHaveLength(2);
      expect(result.pagination.totalRows).toBe(2);
    });
  });

  describe('getServiceRequestsByTenant', () => {
    const mockTenantId = 'tenant-uuid';
    const mockQueryParams = { page: 1, size: 10 };

    it('should return service requests by tenant', async () => {
      const mockRequests = [
        { id: '1', tenant_id: mockTenantId },
        { id: '2', tenant_id: mockTenantId },
      ];

      mockServiceRequestRepository.findAndCount.mockResolvedValue([
        mockRequests,
        2,
      ]);

      const result = await service.getServiceRequestsByTenant(
        mockTenantId,
        mockQueryParams,
      );

      expect(result.service_requests).toHaveLength(2);
      expect(mockServiceRequestRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { tenant_id: mockTenantId },
        }),
      );
    });
  });

  describe('getRequestById', () => {
    const mockRequestId = 'request-uuid';

    it('should return a request with messages', async () => {
      const mockRequest = {
        id: mockRequestId,
        messages: [{ id: '1', content: 'Test message' }],
      };

      mockServiceRequestRepository.findOne.mockResolvedValue(mockRequest);

      const result = await service.getRequestById(mockRequestId);

      expect(mockServiceRequestRepository.findOne).toHaveBeenCalledWith({
        where: { id: mockRequestId },
        relations: ['messages'],
      });
      expect(result).toEqual(mockRequest);
    });

    it('should throw NotFoundException if request not found', async () => {
      mockServiceRequestRepository.findOne.mockResolvedValue(null);

      await expect(service.getRequestById(mockRequestId)).rejects.toThrow(
        'Service request not found',
      );
    });
  });
});
