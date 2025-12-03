import { Test, TestingModule } from '@nestjs/testing';
import { ServiceRequestsService } from '../../src/service-requests/service-requests.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ServiceRequest } from '../../src/service-requests/entities/service-request.entity';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { TeamMember } from '../../src/users/entities/team-member.entity';
import { UtilService } from '../../src/utils/utility-service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { HttpException, NotFoundException } from '@nestjs/common';
import {
  ServiceRequestStatusEnum,
  CreateServiceRequestDto,
} from '../../src/service-requests/dto/create-service-request.dto';
import { TenantStatusEnum } from '../../src/properties/dto/create-property.dto';
import { RolesEnum } from '../../src/base.entity';

type MockRepository = Partial<Record<keyof Repository<any>, jest.Mock>>;

describe('ServiceRequestsService', () => {
  let service: ServiceRequestsService;
  let serviceRequestRepository: MockRepository;
  let propertyTenantRepository: MockRepository;
  let teamMemberRepository: MockRepository;
  let utilService: Partial<UtilService>;
  let eventEmitter: Partial<EventEmitter2>;

  const mockServiceRequest = {
    id: 'sr-123',
    request_id: 'SR-001',
    tenant_id: 'tenant-123',
    property_id: 'property-123',
    tenant_name: 'John Doe',
    property_name: 'Test Property',
    issue_category: 'plumbing',
    description: 'Leaking faucet',
    status: ServiceRequestStatusEnum.PENDING,
    date_reported: new Date(),
    created_at: new Date(),
  };

  beforeEach(async () => {
    const createMockRepository = (): MockRepository => ({
      save: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    });

    serviceRequestRepository = createMockRepository();
    propertyTenantRepository = createMockRepository();
    teamMemberRepository = createMockRepository();

    utilService = {
      normalizePhoneNumber: jest.fn((phone) => phone),
      toSentenceCase: jest.fn((text) => text),
      generateServiceRequestId: jest.fn(() => 'SR-001'),
    };

    eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceRequestsService,
        {
          provide: getRepositoryToken(ServiceRequest),
          useValue: serviceRequestRepository,
        },
        {
          provide: getRepositoryToken(PropertyTenant),
          useValue: propertyTenantRepository,
        },
        {
          provide: getRepositoryToken(TeamMember),
          useValue: teamMemberRepository,
        },
        {
          provide: UtilService,
          useValue: utilService,
        },
        {
          provide: EventEmitter2,
          useValue: eventEmitter,
        },
      ],
    }).compile();

    service = module.get<ServiceRequestsService>(ServiceRequestsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createServiceRequest', () => {
    const createDto: CreateServiceRequestDto = {
      tenant_id: 'tenant-123',
      property_id: 'property-123',
      text: 'Leaking faucet in kitchen',
    };

    const mockPropertyTenant = {
      id: 'pt-123',
      tenant_id: 'tenant-123',
      property_id: 'property-123',
      status: TenantStatusEnum.ACTIVE,
      tenant: {
        id: 'tenant-123',
        user: {
          first_name: 'John',
          last_name: 'Doe',
          phone_number: '+1234567890',
        },
      },
      property: {
        id: 'property-123',
        name: 'Test Property',
        location: 'Test Location',
        owner_id: 'owner-123',
      },
    };

    const mockFacilityManagers = [
      {
        id: 'fm-1',
        role: RolesEnum.FACILITY_MANAGER,
        account: {
          user: {
            first_name: 'Manager',
            last_name: 'One',
            phone_number: '+1111111111',
          },
        },
      },
    ];

    it('should create service request successfully', async () => {
      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(
        mockPropertyTenant,
      );
      (teamMemberRepository.find as jest.Mock).mockResolvedValue(
        mockFacilityManagers,
      );
      (serviceRequestRepository.create as jest.Mock).mockReturnValue(
        mockServiceRequest,
      );
      (serviceRequestRepository.save as jest.Mock).mockResolvedValue(
        mockServiceRequest,
      );

      const result = await service.createServiceRequest(createDto);

      expect(result).toBeDefined();
      expect(result.request_id).toBe('SR-001');
      expect(result.property_name).toBe('Test Property');
      expect(propertyTenantRepository.findOne).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-123',
          status: TenantStatusEnum.ACTIVE,
          property_id: 'property-123',
        },
        relations: ['tenant', 'tenant.user', 'property'],
      });
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'service.created',
        expect.objectContaining({
          user_id: 'tenant-123',
          property_id: 'property-123',
          landlord_id: 'owner-123',
        }),
      );
    });

    it('should throw error if tenant not renting property', async () => {
      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.createServiceRequest(createDto)).rejects.toThrow(
        HttpException,
      );
      await expect(service.createServiceRequest(createDto)).rejects.toThrow(
        'You are not currently renting this property',
      );
    });

    it('should throw error if no facility manager assigned', async () => {
      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(
        mockPropertyTenant,
      );
      (teamMemberRepository.find as jest.Mock).mockResolvedValue([]);

      await expect(service.createServiceRequest(createDto)).rejects.toThrow(
        HttpException,
      );
      await expect(service.createServiceRequest(createDto)).rejects.toThrow(
        'No facility manager assigned to this property yet',
      );
    });

    it('should handle event emission failure gracefully', async () => {
      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(
        mockPropertyTenant,
      );
      (teamMemberRepository.find as jest.Mock).mockResolvedValue(
        mockFacilityManagers,
      );
      (serviceRequestRepository.create as jest.Mock).mockReturnValue(
        mockServiceRequest,
      );
      (serviceRequestRepository.save as jest.Mock).mockResolvedValue(
        mockServiceRequest,
      );
      (eventEmitter.emit as jest.Mock).mockImplementation(() => {
        throw new Error('Event emission failed');
      });

      // Should not throw - event emission failure should be logged but not fail the request
      const result = await service.createServiceRequest(createDto);
      expect(result).toBeDefined();
    });
  });

  describe('getAllServiceRequests', () => {
    it('should return paginated service requests for owner', async () => {
      const mockRequests = [mockServiceRequest];
      (serviceRequestRepository.findAndCount as jest.Mock).mockResolvedValue([
        mockRequests,
        1,
      ]);

      const result = await service.getAllServiceRequests('owner-123', {
        page: 1,
        size: 10,
      });

      expect(result.service_requests).toEqual(mockRequests);
      expect(result.pagination).toEqual({
        totalRows: 1,
        perPage: 10,
        currentPage: 1,
        totalPages: 1,
        hasNextPage: false,
      });
      expect(serviceRequestRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            property: { owner_id: 'owner-123' },
          }),
        }),
      );
    });

    it('should use default pagination values', async () => {
      (serviceRequestRepository.findAndCount as jest.Mock).mockResolvedValue([
        [],
        0,
      ]);

      await service.getAllServiceRequests('owner-123', {});

      expect(serviceRequestRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        }),
      );
    });
  });

  describe('getServiceRequestById', () => {
    it('should return service request by id', async () => {
      const mockRequestWithRelations = {
        ...mockServiceRequest,
        tenant: { id: 'tenant-123' },
        property: { id: 'property-123' },
      };

      (serviceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );

      const result = await service.getServiceRequestById('sr-123');

      expect(result).toEqual(mockRequestWithRelations);
      expect(serviceRequestRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'sr-123' },
        relations: ['tenant', 'property'],
      });
    });

    it('should throw NotFoundException when request not found', async () => {
      (serviceRequestRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getServiceRequestById('invalid-id')).rejects.toThrow(
        HttpException,
      );
      await expect(service.getServiceRequestById('invalid-id')).rejects.toThrow(
        'Service request with id: invalid-id not found',
      );
    });
  });

  describe('getServiceRequestByTenant', () => {
    it('should return service requests for tenant with default statuses', async () => {
      const mockRequests = [mockServiceRequest];
      (serviceRequestRepository.find as jest.Mock).mockResolvedValue(
        mockRequests,
      );

      const result = await service.getServiceRequestByTenant('tenant-123');

      expect(result).toEqual(mockRequests);
      expect(serviceRequestRepository.find).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-123',
          status: expect.anything(),
        },
        relations: ['tenant', 'property'],
      });
    });

    it('should filter by specific status', async () => {
      (serviceRequestRepository.find as jest.Mock).mockResolvedValue([]);

      await service.getServiceRequestByTenant('tenant-123', 'resolved');

      expect(serviceRequestRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: 'tenant-123',
          }),
        }),
      );
    });
  });

  describe('updateServiceRequestById', () => {
    it('should update service request', async () => {
      const updateData = {
        status: ServiceRequestStatusEnum.IN_PROGRESS,
        property_name: 'Test Property',
        tenant_name: 'John Doe',
      };
      (serviceRequestRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updateServiceRequestById('sr-123', updateData as any);

      expect(serviceRequestRepository.update).toHaveBeenCalledWith(
        'sr-123',
        updateData,
      );
    });
  });

  describe('deleteServiceRequestById', () => {
    it('should delete service request', async () => {
      (serviceRequestRepository.delete as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.deleteServiceRequestById('sr-123');

      expect(serviceRequestRepository.delete).toHaveBeenCalledWith('sr-123');
    });
  });

  describe('getPendingAndUrgentRequests', () => {
    it('should return only pending and urgent requests', async () => {
      const mockRequests = [
        { ...mockServiceRequest, status: ServiceRequestStatusEnum.PENDING },
        { ...mockServiceRequest, status: ServiceRequestStatusEnum.URGENT },
      ];

      (serviceRequestRepository.findAndCount as jest.Mock).mockResolvedValue([
        mockRequests,
        2,
      ]);

      const result = await service.getPendingAndUrgentRequests(
        { page: 1, size: 10 },
        'owner-123',
      );

      expect(result.service_requests).toEqual(mockRequests);
      expect(serviceRequestRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            property: { owner_id: 'owner-123' },
          }),
        }),
      );
    });
  });

  describe('getServiceRequestsByTenant', () => {
    it('should return paginated requests for specific tenant', async () => {
      const mockRequests = [mockServiceRequest];
      (serviceRequestRepository.findAndCount as jest.Mock).mockResolvedValue([
        mockRequests,
        1,
      ]);

      const result = await service.getServiceRequestsByTenant('tenant-123', {
        page: 1,
        size: 10,
      });

      expect(result.service_requests).toEqual(mockRequests);
      expect(result.pagination.totalRows).toBe(1);
    });
  });

  describe('getRequestById', () => {
    it('should return request with messages', async () => {
      const mockRequestWithMessages = {
        ...mockServiceRequest,
        messages: [{ id: 'msg-1', text: 'Test message' }],
      };

      (serviceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithMessages,
      );

      const result = await service.getRequestById('sr-123');

      expect(result).toEqual(mockRequestWithMessages);
      expect(serviceRequestRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'sr-123' },
        relations: ['messages'],
      });
    });

    it('should throw NotFoundException when request not found', async () => {
      (serviceRequestRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getRequestById('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateStatus', () => {
    const mockRequestWithRelations = {
      ...mockServiceRequest,
      tenant: { id: 'tenant-123' },
      property: { id: 'property-123', owner_id: 'owner-123' },
    };

    it('should update status and emit event', async () => {
      (serviceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );
      (serviceRequestRepository.save as jest.Mock).mockResolvedValue({
        ...mockRequestWithRelations,
        status: ServiceRequestStatusEnum.IN_PROGRESS,
      });

      const result = await service.updateStatus(
        'sr-123',
        ServiceRequestStatusEnum.IN_PROGRESS,
        'Working on it',
      );

      expect(result.status).toBe(ServiceRequestStatusEnum.IN_PROGRESS);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'service.updated',
        expect.objectContaining({
          request_id: 'sr-123',
          status: ServiceRequestStatusEnum.IN_PROGRESS,
          previous_status: ServiceRequestStatusEnum.PENDING,
        }),
      );
    });

    it('should set resolution_date when status is RESOLVED', async () => {
      (serviceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );

      let savedRequest: any;
      (serviceRequestRepository.save as jest.Mock).mockImplementation(
        (request) => {
          savedRequest = request;
          return Promise.resolve(request);
        },
      );

      await service.updateStatus('sr-123', ServiceRequestStatusEnum.RESOLVED);

      expect(savedRequest.resolution_date).toBeInstanceOf(Date);
    });

    it('should set reopened_at when status is REOPENED', async () => {
      (serviceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );

      let savedRequest: any;
      (serviceRequestRepository.save as jest.Mock).mockImplementation(
        (request) => {
          savedRequest = request;
          return Promise.resolve(request);
        },
      );

      await service.updateStatus('sr-123', ServiceRequestStatusEnum.REOPENED);

      expect(savedRequest.reopened_at).toBeInstanceOf(Date);
    });

    it('should throw NotFoundException when request not found', async () => {
      (serviceRequestRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateStatus(
          'invalid-id',
          ServiceRequestStatusEnum.IN_PROGRESS,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should include actor information in event', async () => {
      (serviceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );
      (serviceRequestRepository.save as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );

      const actor = { id: 'user-123', role: 'landlord', name: 'John Doe' };

      await service.updateStatus(
        'sr-123',
        ServiceRequestStatusEnum.IN_PROGRESS,
        undefined,
        actor,
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'service.updated',
        expect.objectContaining({
          actor,
        }),
      );
    });
  });
});
