import { Test, TestingModule } from '@nestjs/testing';
import { MaintenanceRequestsService } from '../../src/maintenance-requests/maintenance-requests.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { MaintenanceRequest } from '../../src/maintenance-requests/entities/maintenance-request.entity';
import { MaintenanceRequestStatusHistory } from '../../src/maintenance-requests/entities/maintenance-request-status-history.entity';
import { MaintenanceResolutionAttempt } from '../../src/maintenance-requests/entities/maintenance-resolution-attempt.entity';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { Property } from '../../src/properties/entities/property.entity';
import { TeamMember } from '../../src/users/entities/team-member.entity';
import { CommonArea } from '../../src/common-areas/entities/common-area.entity';
import { Account } from '../../src/users/entities/account.entity';
import { UtilService } from '../../src/utils/utility-service';
import { ArtisansService } from '../../src/artisans/artisans.service';
import { ManagementScopeService } from '../../src/common/scope/management-scope.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, Repository } from 'typeorm';
import { HttpException, NotFoundException } from '@nestjs/common';
import {
  MaintenanceRequestStatusEnum,
  MaintenanceRequestCreatorTypeEnum,
  CreateMaintenanceRequestDto,
} from '../../src/maintenance-requests/dto/create-maintenance-request.dto';
import { TenantStatusEnum } from '../../src/properties/dto/create-property.dto';
import { RolesEnum } from '../../src/base.entity';

type MockRepository = Partial<Record<keyof Repository<any>, jest.Mock>>;

/**
 * Chainable TypeORM query-builder mock. Every builder method returns the
 * same object; terminal methods resolve to overridable defaults.
 */
const createMockQueryBuilder = () => {
  const qb: any = {};
  for (const method of [
    'select',
    'addSelect',
    'leftJoinAndSelect',
    'innerJoin',
    'innerJoinAndSelect',
    'where',
    'andWhere',
    'orderBy',
    'addOrderBy',
    'skip',
    'take',
  ]) {
    qb[method] = jest.fn().mockReturnValue(qb);
  }
  qb.getMany = jest.fn().mockResolvedValue([]);
  qb.getOne = jest.fn().mockResolvedValue(null);
  qb.getManyAndCount = jest.fn().mockResolvedValue([[], 0]);
  qb.getRawOne = jest.fn().mockResolvedValue(undefined);
  return qb;
};

describe('MaintenanceRequestsService', () => {
  let service: MaintenanceRequestsService;
  let maintenanceRequestRepository: MockRepository;
  let statusHistoryRepository: MockRepository;
  let resolutionAttemptRepository: MockRepository;
  let propertyTenantRepository: MockRepository;
  let propertyRepository: MockRepository;
  let teamMemberRepository: MockRepository;
  let commonAreaRepository: MockRepository;
  let accountRepository: MockRepository;
  let utilService: Partial<UtilService>;
  let eventEmitter: Partial<EventEmitter2>;
  let scopeService: {
    resolveTeamOwnersForLandlord: jest.Mock;
    resolveLandlordsForTeamCreators: jest.Mock;
    managesLandlord: jest.Mock;
  };
  let artisansService: {
    resolveCallerTeamId: jest.Mock;
    findOrCreateForResolution: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };
  let entityManager: { update: jest.Mock; getRepository: jest.Mock };
  let mrQueryBuilder: any;
  let teamMemberQueryBuilder: any;
  let statusHistoryQueryBuilder: any;

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
      insert: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      softDelete: jest.fn(),
      createQueryBuilder: jest.fn(),
    });

    maintenanceRequestRepository = createMockRepository();
    statusHistoryRepository = createMockRepository();
    resolutionAttemptRepository = createMockRepository();
    propertyTenantRepository = createMockRepository();
    propertyRepository = createMockRepository();
    teamMemberRepository = createMockRepository();
    commonAreaRepository = createMockRepository();
    accountRepository = createMockRepository();

    mrQueryBuilder = createMockQueryBuilder();
    (maintenanceRequestRepository.createQueryBuilder as jest.Mock).mockReturnValue(
      mrQueryBuilder,
    );
    teamMemberQueryBuilder = createMockQueryBuilder();
    (teamMemberRepository.createQueryBuilder as jest.Mock).mockReturnValue(
      teamMemberQueryBuilder,
    );
    statusHistoryQueryBuilder = createMockQueryBuilder();
    (statusHistoryRepository.createQueryBuilder as jest.Mock).mockReturnValue(
      statusHistoryQueryBuilder,
    );

    // Audit rows: create() echoes its input, save() resolves it.
    (statusHistoryRepository.create as jest.Mock).mockImplementation(
      (entry) => entry,
    );
    (statusHistoryRepository.save as jest.Mock).mockImplementation((entry) =>
      Promise.resolve(entry),
    );
    // No resolution attempts by default (patchLatestAttemptOutcome no-ops).
    (resolutionAttemptRepository.findOne as jest.Mock).mockResolvedValue(null);

    utilService = {
      normalizePhoneNumber: jest.fn((phone) => phone),
      toSentenceCase: jest.fn((text) => text),
      generateMaintenanceRequestId: jest.fn(() => 'SR-001'),
    };

    eventEmitter = {
      emit: jest.fn(),
    };

    scopeService = {
      resolveTeamOwnersForLandlord: jest.fn().mockResolvedValue(['owner-123']),
      resolveLandlordsForTeamCreators: jest.fn().mockResolvedValue([]),
      managesLandlord: jest.fn().mockResolvedValue(false),
    };

    artisansService = {
      resolveCallerTeamId: jest.fn(),
      findOrCreateForResolution: jest.fn(),
    };

    entityManager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      getRepository: jest.fn((entity: unknown) => {
        if (entity === MaintenanceRequestStatusHistory) {
          return statusHistoryRepository;
        }
        if (entity === MaintenanceResolutionAttempt) {
          return resolutionAttemptRepository;
        }
        return maintenanceRequestRepository;
      }),
    };
    dataSource = {
      transaction: jest.fn(async (cb: (manager: any) => Promise<any>) =>
        cb(entityManager),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MaintenanceRequestsService,
        {
          provide: getRepositoryToken(MaintenanceRequest),
          useValue: maintenanceRequestRepository,
        },
        {
          provide: getRepositoryToken(MaintenanceRequestStatusHistory),
          useValue: statusHistoryRepository,
        },
        {
          provide: getRepositoryToken(MaintenanceResolutionAttempt),
          useValue: resolutionAttemptRepository,
        },
        {
          provide: getRepositoryToken(PropertyTenant),
          useValue: propertyTenantRepository,
        },
        {
          provide: getRepositoryToken(Property),
          useValue: propertyRepository,
        },
        {
          provide: getRepositoryToken(TeamMember),
          useValue: teamMemberRepository,
        },
        {
          provide: getRepositoryToken(CommonArea),
          useValue: commonAreaRepository,
        },
        {
          provide: getRepositoryToken(Account),
          useValue: accountRepository,
        },
        {
          provide: DataSource,
          useValue: dataSource,
        },
        {
          provide: EventEmitter2,
          useValue: eventEmitter,
        },
        {
          provide: UtilService,
          useValue: utilService,
        },
        {
          provide: ArtisansService,
          useValue: artisansService,
        },
        {
          provide: ManagementScopeService,
          useValue: scopeService,
        },
      ],
    }).compile();

    service = module.get<MaintenanceRequestsService>(MaintenanceRequestsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createMaintenanceRequest', () => {
    // tenant_id was dropped from the DTO — the tenant path now resolves the
    // tenancy from the acting user (actor.id is the tenant's User.id).
    const createDto = {
      property_id: 'property-123',
      text: 'Leaking faucet in kitchen',
    } as CreateMaintenanceRequestDto;

    const tenantActor = { id: 'user-123', role: RolesEnum.TENANT };

    const mockPropertyTenant = {
      id: 'pt-123',
      tenant_id: 'tenant-123',
      property_id: 'property-123',
      status: TenantStatusEnum.ACTIVE,
      tenant: {
        id: 'tenant-123',
        user: {
          id: 'user-123',
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
      teamMemberQueryBuilder.getMany.mockResolvedValue(mockFacilityManagers);
      (maintenanceRequestRepository.create as jest.Mock).mockReturnValue(
        mockMaintenanceRequest,
      );
      (maintenanceRequestRepository.save as jest.Mock).mockResolvedValue(
        mockMaintenanceRequest,
      );

      const result = await service.createMaintenanceRequest(
        createDto,
        tenantActor,
      );

      expect(result).toBeDefined();
      expect(result.request_id).toBe('SR-001');
      expect(result.property_name).toBe('Test Property');
      expect(propertyTenantRepository.findOne).toHaveBeenCalledWith({
        where: {
          tenant: { user: { id: 'user-123' } },
          property_id: 'property-123',
          status: TenantStatusEnum.ACTIVE,
        },
        relations: ['tenant', 'tenant.user', 'property'],
      });
      // Creation writes a status-history audit row.
      expect(statusHistoryRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          maintenance_request_id: 'sr-123',
          previous_status: null,
          new_status: MaintenanceRequestStatusEnum.NOT_APPROVED,
          changed_by_role: 'tenant',
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'maintenance.created',
        expect.objectContaining({
          user_id: 'tenant-123',
          property_id: 'property-123',
          landlord_id: 'owner-123',
        }),
      );
    });

    it('should throw error when unauthenticated (no actor)', async () => {
      await expect(service.createMaintenanceRequest(createDto)).rejects.toThrow(
        'Authentication required',
      );
    });

    it('should throw error if tenant not renting property', async () => {
      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createMaintenanceRequest(createDto, tenantActor),
      ).rejects.toThrow(HttpException);
      await expect(
        service.createMaintenanceRequest(createDto, tenantActor),
      ).rejects.toThrow('You are not currently renting this property');
    });

    it('should still create the request when the landlord has no facility managers yet', async () => {
      // FM assignment now happens at landlord-approval time, so an empty FM
      // team no longer blocks creation — it just fans out to nobody.
      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(
        mockPropertyTenant,
      );
      teamMemberQueryBuilder.getMany.mockResolvedValue([]);
      (maintenanceRequestRepository.create as jest.Mock).mockReturnValue(
        mockMaintenanceRequest,
      );
      (maintenanceRequestRepository.save as jest.Mock).mockResolvedValue(
        mockMaintenanceRequest,
      );

      const result = await service.createMaintenanceRequest(
        createDto,
        tenantActor,
      );

      expect(result).toBeDefined();
      expect(result.facility_managers).toEqual([]);
      expect(maintenanceRequestRepository.save).toHaveBeenCalled();
    });

    it('should handle event emission failure gracefully', async () => {
      (propertyTenantRepository.findOne as jest.Mock).mockResolvedValue(
        mockPropertyTenant,
      );
      teamMemberQueryBuilder.getMany.mockResolvedValue(mockFacilityManagers);
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
      const result = await service.createMaintenanceRequest(
        createDto,
        tenantActor,
      );
      expect(result).toBeDefined();
    });
  });

  describe('getAllMaintenanceRequests', () => {
    it('should return paginated maintenance requests for owner', async () => {
      const mockRequests = [mockMaintenanceRequest];
      mrQueryBuilder.getManyAndCount.mockResolvedValue([mockRequests, 1]);

      const result = await service.getAllMaintenanceRequests('owner-123', {
        page: 1,
        size: 10,
      });

      // The service appends the resolved creator display name to each row.
      expect(result.maintenance_requests).toEqual([
        { ...mockMaintenanceRequest, creator_name: null },
      ]);
      expect(result.pagination).toEqual({
        totalRows: 1,
        perPage: 10,
        currentPage: 1,
        totalPages: 1,
        hasNextPage: false,
      });
      // Landlord scope: own properties OR own common areas.
      expect(mrQueryBuilder.andWhere).toHaveBeenCalledWith(
        expect.stringContaining('property.owner_id = :ownerAccountId'),
        { ownerAccountId: 'owner-123' },
      );
    });

    it('should use default pagination values', async () => {
      mrQueryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

      await service.getAllMaintenanceRequests('owner-123', {});

      expect(mrQueryBuilder.skip).toHaveBeenCalledWith(0);
      expect(mrQueryBuilder.take).toHaveBeenCalledWith(10);
    });
  });

  describe('getMaintenanceRequestById', () => {
    const mockRequestWithRelations = {
      ...mockMaintenanceRequest,
      tenant: { id: 'tenant-123' },
      // Caller must be readable — make them the owning landlord.
      property: { id: 'property-123', owner_id: 'user-123' },
    };

    it('should return maintenance request by id', async () => {
      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue(
        mockRequestWithRelations,
      );

      const result = await service.getMaintenanceRequestById(
        'sr-123',
        'user-123',
      );

      expect(result).toEqual({
        ...mockRequestWithRelations,
        creator_name: null,
      });
      expect(maintenanceRequestRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sr-123' },
          relations: expect.arrayContaining([
            'tenant',
            'property',
            'statusHistory',
          ]),
        }),
      );
    });

    it('should throw NotFoundException when request not found', async () => {
      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.getMaintenanceRequestById('invalid-id', 'user-123'),
      ).rejects.toThrow(HttpException);
      await expect(
        service.getMaintenanceRequestById('invalid-id', 'user-123'),
      ).rejects.toThrow('Maintenance request with id: invalid-id not found');
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
      expect(maintenanceRequestRepository.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            tenant_id: 'tenant-123',
            status: expect.anything(),
          },
          relations: expect.arrayContaining(['tenant', 'property']),
        }),
      );
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
    it('should apply a whitelisted status update inside a transaction and emit', async () => {
      const existingRequest = {
        ...mockMaintenanceRequest,
        status: MaintenanceRequestStatusEnum.NOT_APPROVED,
        creator_type: MaintenanceRequestCreatorTypeEnum.TENANT,
        assigned_to: 'tm-1',
        is_priority: false,
        current_attempt: 1,
        // Caller is the owning landlord → allowed to approve.
        property: { id: 'property-123', owner_id: 'user-123' },
        common_area: null,
      };
      const updatedRequest = {
        ...existingRequest,
        status: MaintenanceRequestStatusEnum.APPROVED,
      };
      (maintenanceRequestRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(existingRequest)
        .mockResolvedValueOnce(updatedRequest);
      (accountRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'user-123',
        profile_name: null,
        user: { id: 'audit-user-1', first_name: 'Land', last_name: 'Lord' },
      });

      const result = await service.updateMaintenanceRequestById(
        'sr-123',
        {
          status: MaintenanceRequestStatusEnum.APPROVED,
          // Non-whitelisted fields must NOT reach the update.
          property_name: 'Hacked Name',
          tenant_name: 'Hacked Tenant',
        } as any,
        'user-123',
      );

      // Update happens inside the transaction with ONLY whitelisted fields.
      expect(entityManager.update).toHaveBeenCalledWith(
        MaintenanceRequest,
        'sr-123',
        { status: MaintenanceRequestStatusEnum.APPROVED },
      );
      // Status change writes an audit row attributed to the resolved user.
      expect(statusHistoryRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          maintenance_request_id: 'sr-123',
          previous_status: MaintenanceRequestStatusEnum.NOT_APPROVED,
          new_status: MaintenanceRequestStatusEnum.APPROVED,
          changed_by_user_id: 'audit-user-1',
          changed_by_role: 'landlord',
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'maintenance.updated',
        expect.objectContaining({
          request_id: 'sr-123',
          status: MaintenanceRequestStatusEnum.APPROVED,
          previous_status: MaintenanceRequestStatusEnum.NOT_APPROVED,
          actor: { id: 'user-123', role: 'landlord' },
        }),
      );
      expect(result).toEqual(updatedRequest);
    });

    it('should reject callers with no role on the request', async () => {
      (maintenanceRequestRepository.findOne as jest.Mock)
        .mockResolvedValue({
          ...mockMaintenanceRequest,
          tenant_id: null,
          creator_user_id: 'someone-else',
          property: { id: 'property-123', owner_id: 'owner-123' },
          common_area: null,
        });
      teamMemberQueryBuilder.getOne.mockResolvedValue(null);

      await expect(
        service.updateMaintenanceRequestById(
          'sr-123',
          { status: MaintenanceRequestStatusEnum.APPROVED } as any,
          'stranger-999',
        ),
      ).rejects.toThrow(
        'You do not have permission to update this maintenance request',
      );
      expect(entityManager.update).not.toHaveBeenCalled();
    });
  });

  describe('deleteMaintenanceRequestById', () => {
    it('should soft-delete maintenance request for the owning landlord', async () => {
      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockMaintenanceRequest,
        creator_user_id: 'someone-else',
        property: { id: 'property-123', owner_id: 'user-123' },
        common_area: null,
      });
      (maintenanceRequestRepository.softDelete as jest.Mock).mockResolvedValue({
        affected: 1,
      });

      await service.deleteMaintenanceRequestById('sr-123', 'user-123');

      expect(maintenanceRequestRepository.softDelete).toHaveBeenCalledWith(
        'sr-123',
      );
    });

    it('should forbid deletion by an unrelated user', async () => {
      (maintenanceRequestRepository.findOne as jest.Mock).mockResolvedValue({
        ...mockMaintenanceRequest,
        creator_user_id: 'someone-else',
        property: { id: 'property-123', owner_id: 'owner-123' },
        common_area: null,
      });

      await expect(
        service.deleteMaintenanceRequestById('sr-123', 'stranger-999'),
      ).rejects.toThrow(
        'You do not have permission to delete this maintenance request',
      );
      expect(maintenanceRequestRepository.softDelete).not.toHaveBeenCalled();
    });
  });

  describe('getPendingAndUrgentRequests', () => {
    it('should return only pending and urgent requests', async () => {
      const mockRequests = [
        {
          ...mockMaintenanceRequest,
          status: MaintenanceRequestStatusEnum.NOT_APPROVED,
        },
        {
          ...mockMaintenanceRequest,
          status: MaintenanceRequestStatusEnum.NOT_APPROVED,
        },
      ];
      mrQueryBuilder.getManyAndCount.mockResolvedValue([mockRequests, 2]);

      const result = await service.getPendingAndUrgentRequests(
        { page: 1, size: 10 },
        'owner-123',
      );

      expect(result.maintenance_requests).toEqual(mockRequests);
      expect(result.pagination.totalRows).toBe(2);
      // Owner scope covers properties AND common areas.
      expect(mrQueryBuilder.where).toHaveBeenCalledWith(
        expect.stringContaining('property.owner_id IN (:...ownerAccountIds)'),
        { ownerAccountIds: ['owner-123'] },
      );
      // "Needs attention" filter: awaiting approval OR urgent.
      expect(mrQueryBuilder.andWhere).toHaveBeenCalledWith(
        '(sr.status = :notApproved OR sr.is_urgent = :urgent)',
        {
          notApproved: MaintenanceRequestStatusEnum.NOT_APPROVED,
          urgent: true,
        },
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
      expect(maintenanceRequestRepository.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sr-123' },
          relations: expect.arrayContaining(['messages']),
        }),
      );
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

    it('should include actor information in event and write status history', async () => {
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

      expect(statusHistoryRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          maintenance_request_id: 'sr-123',
          new_status: MaintenanceRequestStatusEnum.APPROVED,
          changed_by_user_id: 'user-123',
          changed_by_role: 'landlord',
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'maintenance.updated',
        expect.objectContaining({
          actor,
        }),
      );
    });
  });

  // Landlord-first gate order for FM-filed unit requests:
  //   FM files → NOT_APPROVED → landlord approves + assigns →
  //   PENDING_TENANT_CONFIRMATION → tenant confirms → APPROVED.
  describe('FM-filed landlord-first tenant gate', () => {
    const fmActor = { id: 'fm-acct', role: RolesEnum.FACILITY_MANAGER };
    const fmDto = {
      property_id: 'property-123',
      text: 'Broken heater',
      scope: 'unit',
    } as CreateMaintenanceRequestDto;

    const fmTeamMember = {
      id: 'fm-tm-1',
      role: RolesEnum.FACILITY_MANAGER,
      account: {
        id: 'fm-acct',
        user: { id: 'fm-user', first_name: 'Fixit', last_name: 'Fred' },
      },
      team: { creatorId: 'owner-123' },
    };

    const activeTenancy = {
      id: 'pt-1',
      tenant_id: 'tenant-123',
      property_id: 'property-123',
      status: TenantStatusEnum.ACTIVE,
      tenant: {
        id: 'tenant-123',
        user: {
          id: 'tenant-user',
          first_name: 'Tina',
          last_name: 'Tenant',
          phone_number: '+2340000000',
        },
      },
    };

    it('FM-filed unit request with an active tenant starts in NOT_APPROVED and emits maintenance.created (not the old fm_filed_pending_tenant)', async () => {
      (teamMemberRepository.find as jest.Mock).mockResolvedValue([fmTeamMember]);
      (propertyRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'property-123',
        name: 'Test Property',
        location: 'Test Location',
        owner_id: 'owner-123',
      });
      scopeService.resolveTeamOwnersForLandlord.mockResolvedValue(['owner-123']);
      (propertyTenantRepository.find as jest.Mock).mockResolvedValue([
        activeTenancy,
      ]);
      (maintenanceRequestRepository.create as jest.Mock).mockImplementation(
        (entity) => entity,
      );
      (maintenanceRequestRepository.save as jest.Mock).mockImplementation(
        (entity) =>
          Promise.resolve({
            ...entity,
            id: 'sr-fm-1',
            request_id: 'SR-001',
            created_at: new Date(),
          }),
      );

      await service.createMaintenanceRequest(fmDto, fmActor);

      // Always starts awaiting the landlord — no create-time tenant gate.
      expect(maintenanceRequestRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: MaintenanceRequestStatusEnum.NOT_APPROVED,
          creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
          tenant_id: 'tenant-123',
          assigned_to: null,
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'maintenance.created',
        expect.objectContaining({ landlord_id: 'owner-123' }),
      );
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'maintenance.fm_filed_pending_tenant',
        expect.anything(),
      );
    });

    it('approving an FM-filed request with a tenant routes to PENDING_TENANT_CONFIRMATION, leaves approved_at unstamped, prompts the tenant, and defers the FM assignment ping', async () => {
      const sr = {
        id: 'sr-fm-1',
        request_id: 'SR-001',
        status: MaintenanceRequestStatusEnum.NOT_APPROVED,
        creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
        scope: 'unit',
        tenant_id: 'tenant-123',
        assigned_to: null,
        property: { id: 'property-123', owner_id: 'owner-123' },
        common_area: null,
      };
      const reloaded = {
        ...sr,
        status: MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
        tenant_name: 'Tina Tenant',
        property_name: 'Test Property',
        tenant: { user: { phone_number: '+2340000000' } },
        creator: {
          first_name: 'Fixit',
          last_name: 'Fred',
          accounts: [
            { roles: [RolesEnum.FACILITY_MANAGER], profile_name: 'Fixit Co' },
          ],
        },
        facilityManager: {
          id: 'fm-tm-1',
          account: { user: { first_name: 'Fixit', last_name: 'Fred' } },
        },
      };
      (maintenanceRequestRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(sr)
        .mockResolvedValueOnce(reloaded);
      (teamMemberRepository.findOne as jest.Mock).mockResolvedValue({
        id: 'fm-tm-1',
        role: RolesEnum.FACILITY_MANAGER,
        team: { creatorId: 'owner-123' },
        account: { user: { first_name: 'Fixit', last_name: 'Fred' } },
      });
      (accountRepository.findOne as jest.Mock).mockResolvedValue({
        user: { id: 'owner-user' },
      });

      await service.approveAndAssignMaintenanceRequest(
        'sr-fm-1',
        'fm-tm-1',
        'owner-123',
        'dashboard',
      );

      const updateArg = (entityManager.update as jest.Mock).mock.calls[0][2];
      expect(updateArg.status).toBe(
        MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
      );
      expect(updateArg.assigned_to).toBe('fm-tm-1');
      // approved_at is only stamped when the work actually opens (APPROVED).
      expect(updateArg.approved_at).toBeUndefined();
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'maintenance.landlord_approved_pending_tenant',
        expect.objectContaining({ tenant_id: 'tenant-123' }),
      );
      // FM stays silent until the tenant confirms.
      expect(eventEmitter.emit).not.toHaveBeenCalledWith(
        'maintenance.assigned',
        expect.anything(),
      );
    });

    it('tenant confirmation opens the work: APPROVED, approved_at stamped, and the deferred FM assignment ping fires', async () => {
      const sr = {
        id: 'sr-fm-1',
        request_id: 'SR-001',
        status: MaintenanceRequestStatusEnum.PENDING_TENANT_CONFIRMATION,
        creator_type: MaintenanceRequestCreatorTypeEnum.FACILITY_MANAGER,
        tenant_id: 'tenant-123',
        tenant: { user: { id: 'tenant-user' } },
        property: { id: 'property-123', owner_id: 'owner-123' },
        common_area: null,
      };
      const reloaded = {
        ...sr,
        status: MaintenanceRequestStatusEnum.APPROVED,
        assigned_to: 'fm-tm-1',
        property_name: 'Test Property',
        facilityManager: {
          id: 'fm-tm-1',
          account: { user: { first_name: 'Fixit', last_name: 'Fred' } },
        },
      };
      (maintenanceRequestRepository.findOne as jest.Mock)
        .mockResolvedValueOnce(sr)
        .mockResolvedValueOnce(reloaded);

      await service.confirmTenantMaintenanceRequest(
        'sr-fm-1',
        'tenant-123',
        'dashboard',
      );

      const updateArg = (entityManager.update as jest.Mock).mock.calls[0][2];
      expect(updateArg.status).toBe(MaintenanceRequestStatusEnum.APPROVED);
      expect(updateArg.approved_at).toBeInstanceOf(Date);
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'maintenance.tenant_confirmed',
        expect.objectContaining({ maintenance_request_id: 'sr-fm-1' }),
      );
      // The assignment ping, withheld at approve time, fires now.
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'maintenance.assigned',
        expect.objectContaining({ new_assignee: 'fm-tm-1' }),
      );
    });
  });
});
