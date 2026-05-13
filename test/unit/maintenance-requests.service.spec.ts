import { Test, TestingModule } from '@nestjs/testing';
import { MaintenanceRequestsService } from '../../src/maintenance-requests/maintenance-requests.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MaintenanceRequest } from '../../src/maintenance-requests/entities/maintenance-request.entity';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { TeamMember } from '../../src/users/entities/team-member.entity';
import { UtilService } from '../../src/utils/utility-service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Repository } from 'typeorm';
import { HttpException, NotFoundException } from '@nestjs/common';
import {
  MaintenanceRequestStatusEnum,
  CreateMaintenanceRequestDto,
} from '../../src/maintenance-requests/dto/create-maintenance-request.dto';
import { TenantStatusEnum } from '../../src/properties/dto/create-property.dto';
import { RolesEnum } from '../../src/base.entity';

type MockRepository = Partial<Record<keyof Repository<any>, jest.Mock>>;

describe('MaintenanceRequestsService', () => {
  let service: MaintenanceRequestsService;
  let maintenanceRequestRepository: MockRepository;
  let propertyTenantRepository: MockRepository;
  let teamMemberRepository: MockRepository;
  let utilService: Partial<UtilService>;
  let eventEmitter: Partial<EventEmitter2>;

  const mockMaintenanceRequest = {
    id: 'sr-123',
    request_id: 'SR-001',
    tenant_id: 'tenant-123',
    property_id: 'property-123',
    tenant_name: 'John Doe',
    property_name: 'Test Property',
    issue_category: 'plumbing',
    description: 'Leaking faucet',
    status: MaintenanceRequestStatusEnum.NOT_APPROVED,
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

    maintenanceRequestRepository = createMockRepository();
    propertyTenantRepository = createMockRepository();
    teamMemberRepository = createMockRepository();

    utilService = {
      normalizePhoneNumber: jest.fn((phone) => phone),
      toSentenceCase: jest.fn((text) => text),
      generateMaintenanceRequestId: jest.fn(() => 'SR-001'),
    };

    eventEmitter = {
      emit: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceRequestsService,
        {
          provide: getRepositoryToken(MaintenanceRequest),
          useValue: maintenanceRequestRepository,
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

    service = module.get<MaintenanceRequestsService>(MaintenanceRequestsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createMaintenanceRequest', () => {
    // NOTE: tenant_id was dropped from CreateMaintenanceRequestDto when the
    // controller began deriving it from req.user. Cast preserves the legacy
    // test shape until the suite is rewritten against the new actor-based
    // API; behaviour assertions below are stale and need a follow-up pass.
    const createDto = {
      tenant_id: 'tenant-123',
      property_id: 'property-123',
      text: 'Leaking faucet in kitchen',
    } as unknown as CreateMaintenanceRequestDto;

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

    it('should create maintenance request successfully', async () => {
      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(
        mockPropertyTenant,
      );
      (teamMemberRepository.find as jest.Mock).mockResolvedValue(
        mockFacilityManagers,
      );
      (maintenanceRequestRepository.create as jest.Mock).mockReturnValue(
        mockMaintenanceRequest,
      );
      (maintenanceRequestRepository.save as jest.Mock).mockResolvedValue(
        mockMaintenanceRequest,
      );

      const result = await service.createMaintenanceRequest(createDto);

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
        'maintenance.created',
        expect.objectContaining({
          user_id: 'tenant-123',
          property_id: 'property-123',
          landlord_id: 'owner-123',
        }),
      );
    });

    it('should throw error if tenant not renting property', async () => {
      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.createMaintenanceRequest(createDto)).rejects.toThrow(
        HttpException,
      );
      await expect(service.createMaintenanceRequest(createDto)).rejects.toThrow(
        'You are not currently renting this property',
      );
    });

    it('should throw error if no facility manager assigned', async () => {
      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(
        mockPropertyTenant,
      );
      (teamMemberRepository.find as jest.Mock).mockResolvedValue([]);

      await expect(service.createMaintenanceRequest(createDto)).rejects.toThrow(
        HttpException,
      );
      await expect(service.createMaintenanceRequest(createDto)).rejects.toThrow(
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
      (maintenanceRequestRepository.create as jest.Mock).mockReturnValue(
        mockMaintenanceRequest,
      );
      (maintenanceRequestRepository.save as jest.Mock).mockResolvedValue(
        mockMaintenanceRequest,
      );
      (eventEmitter.emit as jest.Mock).mockImplementation(() => {
        throw new Error('Event emission failed');
      });

      // Should not throw - event emission failure should be logged but not fail the request
      const result = await service.createMaintenanceRequest(createDto);
      expect(result).toBeDefined();
    });
  });

  describe('getAllMaintenanceRequests', () => {
    it('should return paginated maintenance requests for owner', async () => {
      const mockRequests = [mockMaintenanceRequest];
      (maintenanceRequestRepository.findAndCount as jest.Mock).mockResolvedValue([
        mockRequests,
        1,
      ]);

      const result = await service.getAllMaintenanceRequests('owner-123', {
        page: 1,
        size: 10,
      });

      expect(result.maintenance_requests).toEqual(mockRequests);
      expect(result.pagination).toEqual({
        totalRows: 1,
        perPage: 10,
        currentPage: 1,
        totalPages: 1,
        hasNextPage: false,
      });
      expect(maintenanceRequestRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            property: { owner_id: 'owner-123' },
          }),
        }),
      );
    });

    it('should use default pagination values', async () => {
      (maintenanceRequestRepository.findAndCount as jest.Mock).mockResolvedValue([
        [],
        0,
      ]);

      await service.getAllMaintenanceRequests('owner-123', {});

      expect(maintenanceRequestRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 10,
        }),
      );
    });
  });

  describe('getMaintenanceRequestById', () => {
    it('should return maintenance request by id', async () => {
      const mockRequestWithRelations = {
        ...mockMaintenanceRequest,
        tenant: { id: 'tenant-123' },
        property: { id: 'property-123' },
      };

      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );

      const result = await service.getMaintenanceRequestById('sr-123', 'user-123');

      expect(result).toEqual(mockRequestWithRelations);
      expect(maintenanceRequestRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'sr-123' },
        relations: ['tenant', 'property'],
      });
    });

    it('should throw NotFoundException when request not found', async () => {
      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getMaintenanceRequestById('invalid-id', 'user-123')).rejects.toThrow(
        HttpException,
      );
      await expect(service.getMaintenanceRequestById('invalid-id', 'user-123')).rejects.toThrow(
        'Maintenance request with id: invalid-id not found',
      );
    });
  });

  describe('getMaintenanceRequestByTenant', () => {
    it('should return maintenance requests for tenant with default statuses', async () => {
      const mockRequests = [mockMaintenanceRequest];
      (maintenanceRequestRepository.find as jest.Mock).mockResolvedValue(
        mockRequests,
      );

      const result = await service.getMaintenanceRequestByTenant('tenant-123');

      expect(result).toEqual(mockRequests);
      expect(maintenanceRequestRepository.find).toHaveBeenCalledWith({
        where: {
          tenant_id: 'tenant-123',
          status: expect.anything(),
        },
        relations: ['tenant', 'property'],
      });
    });

    it('should filter by specific status', async () => {
      (maintenanceRequestRepository.find as jest.Mock).mockResolvedValue([]);

      await service.getMaintenanceRequestByTenant('tenant-123', 'resolved');

      expect(maintenanceRequestRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenant_id: 'tenant-123',
          }),
        }),
      );
    });
  });

  describe('updateMaintenanceRequestById', () => {
    it('should update maintenance request', async () => {
      const updateData = {
        status: MaintenanceRequestStatusEnum.APPROVED,
        property_name: 'Test Property',
        tenant_name: 'John Doe',
      };
      (maintenanceRequestRepository.update as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.updateMaintenanceRequestById(
        'sr-123',
        updateData as any,
        'user-123',
      );

      expect(maintenanceRequestRepository.update).toHaveBeenCalledWith(
        'sr-123',
        updateData,
      );
    });
  });

  describe('deleteMaintenanceRequestById', () => {
    it('should delete maintenance request', async () => {
      (maintenanceRequestRepository.delete as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.deleteMaintenanceRequestById('sr-123', 'user-123');

      expect(maintenanceRequestRepository.delete).toHaveBeenCalledWith('sr-123');
    });
  });

  describe('getPendingAndUrgentRequests', () => {
    it('should return only pending and urgent requests', async () => {
      const mockRequests = [
        { ...mockMaintenanceRequest, status: MaintenanceRequestStatusEnum.NOT_APPROVED },
        { ...mockMaintenanceRequest, status: MaintenanceRequestStatusEnum.NOT_APPROVED },
      ];

      (maintenanceRequestRepository.findAndCount as jest.Mock).mockResolvedValue([
        mockRequests,
        2,
      ]);

      const result = await service.getPendingAndUrgentRequests(
        { page: 1, size: 10 },
        'owner-123',
      );

      expect(result.maintenance_requests).toEqual(mockRequests);
      expect(maintenanceRequestRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            property: { owner_id: 'owner-123' },
          }),
        }),
      );
    });
  });

  describe('getMaintenanceRequestsByTenant', () => {
    it('should return paginated requests for specific tenant', async () => {
      const mockRequests = [mockMaintenanceRequest];
      (maintenanceRequestRepository.findAndCount as jest.Mock).mockResolvedValue([
        mockRequests,
        1,
      ]);

      const result = await service.getMaintenanceRequestsByTenant('tenant-123', {
        page: 1,
        size: 10,
      });

      expect(result.maintenance_requests).toEqual(mockRequests);
      expect(result.pagination.totalRows).toBe(1);
    });
  });

  describe('getRequestById', () => {
    it('should return request with messages', async () => {
      const mockRequestWithMessages = {
        ...mockMaintenanceRequest,
        messages: [{ id: 'msg-1', text: 'Test message' }],
      };

      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithMessages,
      );

      const result = await service.getRequestById('sr-123');

      expect(result).toEqual(mockRequestWithMessages);
      expect(maintenanceRequestRepository.findOne).toHaveBeenCalledWith({
        where: { id: 'sr-123' },
        relations: ['messages'],
      });
    });

    it('should throw NotFoundException when request not found', async () => {
      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(service.getRequestById('invalid-id')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateStatus', () => {
    const mockRequestWithRelations = {
      ...mockMaintenanceRequest,
      tenant: { id: 'tenant-123' },
      property: { id: 'property-123', owner_id: 'owner-123' },
    };

    it('should update status and emit event', async () => {
      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );
      (maintenanceRequestRepository.save as jest.Mock).mockResolvedValue({
        ...mockRequestWithRelations,
        status: MaintenanceRequestStatusEnum.APPROVED,
      });

      const result = await service.updateStatus(
        'sr-123',
        MaintenanceRequestStatusEnum.APPROVED,
        'Working on it',
      );

      expect(result.status).toBe(MaintenanceRequestStatusEnum.APPROVED);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'maintenance.updated',
        expect.objectContaining({
          request_id: 'sr-123',
          status: MaintenanceRequestStatusEnum.APPROVED,
          previous_status: MaintenanceRequestStatusEnum.NOT_APPROVED,
        }),
      );
    });

    it('should set resolution_date when status is RESOLVED', async () => {
      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );

      let savedRequest: any;
      (maintenanceRequestRepository.save as jest.Mock).mockImplementation(
        (request) => {
          savedRequest = request;
          return Promise.resolve(request);
        },
      );

      await service.updateStatus('sr-123', MaintenanceRequestStatusEnum.RESOLVED);

      expect(savedRequest.resolution_date).toBeInstanceOf(Date);
    });

    it('should set reopened_at when status is REOPENED', async () => {
      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );

      let savedRequest: any;
      (maintenanceRequestRepository.save as jest.Mock).mockImplementation(
        (request) => {
          savedRequest = request;
          return Promise.resolve(request);
        },
      );

      await service.updateStatus('sr-123', MaintenanceRequestStatusEnum.REOPENED);

      expect(savedRequest.reopened_at).toBeInstanceOf(Date);
    });

    it('should throw NotFoundException when request not found', async () => {
      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.updateStatus(
          'invalid-id',
          MaintenanceRequestStatusEnum.APPROVED,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('should include actor information in event', async () => {
      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );
      (maintenanceRequestRepository.save as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );

      const actor = { id: 'user-123', role: 'landlord', name: 'John Doe' };

      await service.updateStatus(
        'sr-123',
        MaintenanceRequestStatusEnum.APPROVED,
        undefined,
        actor,
      );

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'maintenance.updated',
        expect.objectContaining({
          actor,
        }),
      );
    });
  });
});
