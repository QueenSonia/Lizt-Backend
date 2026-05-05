import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { HttpException, HttpStatus } from '@nestjs/common';
import { Repository, EntityManager } from 'typeorm';
import { PropertyHistoryService } from '../../src/property-history/property-history.service';
import { PropertyHistory } from '../../src/property-history/entities/property-history.entity';
import { Property } from '../../src/properties/entities/property.entity';
import { Rent } from '../../src/rents/entities/rent.entity';
import {
  RentStatusEnum,
  RentPaymentStatusEnum,
} from '../../src/rents/dto/create-rent.dto';
import { TenantBalanceLedger, TenantBalanceLedgerType } from '../../src/tenant-balances/entities/tenant-balance-ledger.entity';
import { TenantBalancesService } from '../../src/tenant-balances/tenant-balances.service';
import { NotificationService } from '../../src/notifications/notification.service';
import { EventsGateway } from '../../src/events/events.gateway';
import { KYCApplication } from '../../src/kyc-links/entities/kyc-application.entity';

type MockRepository = Partial<Record<keyof Repository<any>, jest.Mock>>;

describe('PropertyHistoryService — staged applicant + replay', () => {
  let service: PropertyHistoryService;
  let propertyHistoryRepo: MockRepository;
  let propertyRepo: MockRepository;
  let rentRepo: MockRepository;
  let ledgerRepo: MockRepository;
  let kycAppRepo: MockRepository;
  let tenantBalancesService: { applyChange: jest.Mock };
  let notificationService: { create: jest.Mock };
  let eventsGateway: { emitHistoryAdded: jest.Mock };

  // The shape replay accepts as `manager`. We hand-roll a minimal mock that
  // exposes `getRepository` returning thin in-memory stores so we can inspect
  // what replay wrote without spinning up a real connection.
  const makeManagerMock = (
    stagedRows: any[],
    initialRents: any[] = [],
  ): {
    manager: EntityManager;
    phStore: any[];
    rentStore: any[];
  } => {
    const phStore = [...stagedRows];
    const rentStore = [...initialRents];

    const phRepoMock = {
      find: jest.fn().mockImplementation(({ where, order: _order }: any) => {
        return Promise.resolve(
          phStore.filter((r) => {
            if (where.related_entity_type && r.related_entity_type !== where.related_entity_type) return false;
            if (where.related_entity_id && r.related_entity_id !== where.related_entity_id) return false;
            // IsNull() check for tenant_id
            if (where.tenant_id && !r.tenant_id) return true;
            if (where.tenant_id && r.tenant_id) return false;
            return true;
          }),
        );
      }),
      update: jest.fn().mockImplementation(async (id: string, patch: any) => {
        const row = phStore.find((r) => r.id === id);
        if (row) Object.assign(row, patch);
        return { affected: row ? 1 : 0 };
      }),
      createQueryBuilder: jest.fn().mockImplementation(() => {
        const where: any = {};
        const qb: any = {
          where: jest.fn().mockImplementation((_clause: string, params: any) => {
            Object.assign(where, params);
            return qb;
          }),
          andWhere: jest.fn().mockImplementation((_clause: string, params?: any) => {
            if (params) Object.assign(where, params);
            return qb;
          }),
          getOne: jest.fn().mockImplementation(() =>
            Promise.resolve(null), // no staged-tenancy clashes by default
          ),
          getMany: jest.fn().mockResolvedValue([]),
        };
        return qb;
      }),
    };

    const rentRepoMock = {
      find: jest.fn().mockResolvedValue(rentStore),
      findOne: jest.fn().mockImplementation(({ where }: any) =>
        Promise.resolve(
          rentStore.find(
            (r) =>
              r.tenant_id === where.tenant_id &&
              r.property_id === where.property_id &&
              r.rent_start_date?.getTime?.() === where.rent_start_date?.getTime?.() &&
              r.rent_status === where.rent_status,
          ) || null,
        ),
      ),
      create: jest.fn().mockImplementation((data: any) => ({
        id: `rent-${rentStore.length + 1}`,
        ...data,
      })),
      save: jest.fn().mockImplementation(async (input: any) => {
        // TypeORM `save` accepts both single entities and arrays. For arrays
        // (used by syncRentPaymentStatus), only push entries we haven't seen
        // — they're already in `rentStore` since `find()` returned it.
        if (Array.isArray(input)) {
          for (const r of input) {
            if (!rentStore.includes(r)) rentStore.push(r);
          }
          return input;
        }
        rentStore.push(input);
        return input;
      }),
      createQueryBuilder: jest.fn().mockImplementation(() => {
        const qb: any = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(null),
          getMany: jest.fn().mockResolvedValue([]),
        };
        return qb;
      }),
    };

    const manager = {
      getRepository: jest.fn().mockImplementation((entity: any) => {
        if (entity === PropertyHistory) return phRepoMock;
        if (entity === Rent) return rentRepoMock;
        return {};
      }),
    } as unknown as EntityManager;

    return { manager, phStore, rentStore };
  };

  beforeEach(async () => {
    const createMock = (): MockRepository => ({
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      findAndCount: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn(),
    });

    propertyHistoryRepo = createMock();
    propertyRepo = createMock();
    rentRepo = createMock();
    ledgerRepo = createMock();
    kycAppRepo = createMock();

    tenantBalancesService = { applyChange: jest.fn().mockResolvedValue(undefined) };
    notificationService = { create: jest.fn().mockResolvedValue(undefined) };
    eventsGateway = { emitHistoryAdded: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropertyHistoryService,
        { provide: getRepositoryToken(PropertyHistory), useValue: propertyHistoryRepo },
        { provide: getRepositoryToken(Property), useValue: propertyRepo },
        { provide: getRepositoryToken(Rent), useValue: rentRepo },
        { provide: getRepositoryToken(TenantBalanceLedger), useValue: ledgerRepo },
        { provide: getRepositoryToken(KYCApplication), useValue: kycAppRepo },
        { provide: NotificationService, useValue: notificationService },
        { provide: EventsGateway, useValue: eventsGateway },
        { provide: TenantBalancesService, useValue: tenantBalancesService },
      ],
    }).compile();

    service = module.get<PropertyHistoryService>(PropertyHistoryService);
  });

  describe('createPropertyHistory — staged-applicant routing', () => {
    it('routes a staged-applicant tenancy through handleStagedTenancyEntry (no Rent / no ledger)', async () => {
      kycAppRepo.findOne!.mockResolvedValue({
        id: 'app-1',
        property_id: 'prop-1',
      });
      // No staged-tenancy clash, no Rent clash
      (rentRepo.createQueryBuilder as jest.Mock).mockImplementation(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      }));
      (propertyHistoryRepo.createQueryBuilder as jest.Mock).mockImplementation(
        () => ({
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getOne: jest.fn().mockResolvedValue(null),
        }),
      );
      propertyHistoryRepo.save!.mockImplementation(async (d) => ({
        id: 'ph-1',
        ...d,
      }));

      const result = await service.createPropertyHistory({
        property_id: 'prop-1',
        related_entity_type: 'kyc_application',
        related_entity_id: 'app-1',
        event_type: 'user_added_tenancy',
        event_description: JSON.stringify({
          rentAmount: 50000,
          totalAmount: 50000,
        }),
        move_in_date: '2026-01-01',
        move_out_date: '2026-12-31',
      });

      expect(propertyHistoryRepo.save).toHaveBeenCalled();
      // Critical: no Rent created, no ledger written for staged rows
      expect(rentRepo.save).not.toHaveBeenCalled();
      expect(tenantBalancesService.applyChange).not.toHaveBeenCalled();
      expect(notificationService.create).not.toHaveBeenCalled();
      expect((result as any).id).toBe('ph-1');
    });

    it('rejects staged-applicant fee entries (out of scope)', async () => {
      await expect(
        service.createPropertyHistory({
          property_id: 'prop-1',
          related_entity_type: 'kyc_application',
          related_entity_id: 'app-1',
          event_type: 'user_added_fee',
          event_description: JSON.stringify({ feeAmount: 1000 }),
        }),
      ).rejects.toThrow(HttpException);
    });

    it('rejects staged tenancy when application belongs to a different property', async () => {
      kycAppRepo.findOne!.mockResolvedValue({
        id: 'app-1',
        property_id: 'prop-OTHER',
      });

      await expect(
        service.createPropertyHistory({
          property_id: 'prop-1',
          related_entity_type: 'kyc_application',
          related_entity_id: 'app-1',
          event_type: 'user_added_tenancy',
          event_description: JSON.stringify({}),
          move_in_date: '2026-01-01',
          move_out_date: '2026-12-31',
        }),
      ).rejects.toThrow(/does not belong/i);
    });
  });

  describe('replayStagedApplicantHistory', () => {
    it('replays tenancies into INACTIVE Rents with the (tenant_id, rent_start_date, INACTIVE) key tenant-mode handlers expect', async () => {
      const moveIn = new Date('2026-01-01');
      const moveOut = new Date('2026-12-31');
      const stagedTenancy = {
        id: 'ph-staged-tenancy',
        property_id: 'prop-1',
        tenant_id: null,
        related_entity_type: 'kyc_application',
        related_entity_id: 'app-1',
        event_type: 'user_added_tenancy',
        event_description: JSON.stringify({
          rentAmount: 50000,
          serviceChargeAmount: 5000,
          totalAmount: 55000,
        }),
        move_in_date: moveIn,
        move_out_date: moveOut,
        created_at: new Date('2026-01-01'),
      };

      const { manager, phStore, rentStore } = makeManagerMock([stagedTenancy]);

      const result = await service.replayStagedApplicantHistory(
        'app-1',
        'tenant-1',
        'landlord-1',
        'prop-1',
        manager,
      );

      expect(result.tenanciesReplayed).toBe(1);
      expect(rentStore).toHaveLength(1);
      // The (tenant_id, rent_start_date, INACTIVE) lookup key the post-attach
      // edit/delete handlers depend on — verify the row carries it.
      expect(rentStore[0]).toEqual(
        expect.objectContaining({
          tenant_id: 'tenant-1',
          property_id: 'prop-1',
          rent_status: RentStatusEnum.INACTIVE,
          rental_price: 50000,
          service_charge: 5000,
        }),
      );
      // payment_status / amount_paid are recomputed by syncRentPaymentStatus
      // at end of replay — not asserted here, that's a separate concern
      // covered by syncRentPaymentStatus's own tests.
      void RentPaymentStatusEnum;
      // Ledger keyed to ('rent', rent.id) — same as tenant-mode handler
      expect(tenantBalancesService.applyChange).toHaveBeenCalledWith(
        'tenant-1',
        'landlord-1',
        -55000,
        expect.objectContaining({
          type: TenantBalanceLedgerType.INITIAL_BALANCE,
          relatedEntityType: 'rent',
        }),
        undefined,
        manager,
      );
      // Row re-tagged to tenant scope
      expect(phStore[0].tenant_id).toBe('tenant-1');
      expect(phStore[0].related_entity_type).toBe('tenant');
      expect(phStore[0].related_entity_id).toBe('tenant-1');
    });

    it('replays payments with ledger keyed to (property_history, row.id) — same as tenant-mode handler', async () => {
      const stagedPayment = {
        id: 'ph-staged-payment',
        property_id: 'prop-1',
        tenant_id: null,
        related_entity_type: 'kyc_application',
        related_entity_id: 'app-1',
        event_type: 'user_added_payment',
        event_description: JSON.stringify({ paymentAmount: 30000 }),
        move_in_date: new Date('2026-02-01'),
        created_at: new Date('2026-02-01'),
      };

      const { manager, phStore } = makeManagerMock([stagedPayment]);

      const result = await service.replayStagedApplicantHistory(
        'app-1',
        'tenant-1',
        'landlord-1',
        'prop-1',
        manager,
      );

      expect(result.paymentsReplayed).toBe(1);
      expect(tenantBalancesService.applyChange).toHaveBeenCalledWith(
        'tenant-1',
        'landlord-1',
        30000,
        expect.objectContaining({
          type: TenantBalanceLedgerType.OB_PAYMENT,
          relatedEntityType: 'property_history',
          relatedEntityId: 'ph-staged-payment',
        }),
        undefined,
        manager,
      );
      expect(phStore[0].tenant_id).toBe('tenant-1');
      expect(phStore[0].related_entity_type).toBe('tenant');
    });

    it('replays tenancies before payments so payment allocation finds the rents', async () => {
      const stagedTenancy = {
        id: 'ph-tenancy',
        property_id: 'prop-1',
        tenant_id: null,
        related_entity_type: 'kyc_application',
        related_entity_id: 'app-1',
        event_type: 'user_added_tenancy',
        event_description: JSON.stringify({ rentAmount: 50000, totalAmount: 50000 }),
        move_in_date: new Date('2026-01-01'),
        move_out_date: new Date('2026-12-31'),
        created_at: new Date('2026-02-01'), // payment first by created_at
      };
      const stagedPayment = {
        id: 'ph-payment',
        property_id: 'prop-1',
        tenant_id: null,
        related_entity_type: 'kyc_application',
        related_entity_id: 'app-1',
        event_type: 'user_added_payment',
        event_description: JSON.stringify({ paymentAmount: 30000 }),
        move_in_date: new Date('2026-01-15'),
        created_at: new Date('2026-01-01'),
      };

      const { manager } = makeManagerMock([stagedPayment, stagedTenancy]);

      await service.replayStagedApplicantHistory(
        'app-1',
        'tenant-1',
        'landlord-1',
        'prop-1',
        manager,
      );

      // First applyChange call should be the tenancy (-totalAmount), then payment (+amount).
      const calls = tenantBalancesService.applyChange.mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(2);
      expect(calls[0][2]).toBe(-50000); // tenancy charge
      expect(calls[1][2]).toBe(30000); // payment credit
    });

    it('throws structured STAGED_TENANCY_CLASH when a staged tenancy overlaps an existing Rent', async () => {
      const moveIn = new Date('2026-01-01');
      const moveOut = new Date('2026-12-31');
      const stagedTenancy = {
        id: 'ph-clash',
        property_id: 'prop-1',
        tenant_id: null,
        related_entity_type: 'kyc_application',
        related_entity_id: 'app-1',
        event_type: 'user_added_tenancy',
        event_description: JSON.stringify({}),
        move_in_date: moveIn,
        move_out_date: moveOut,
        created_at: new Date('2026-01-01'),
      };

      // Override Rent QB to return a clash
      const phStore = [stagedTenancy];
      const rentStore: any[] = [];
      const manager = {
        getRepository: jest.fn().mockImplementation((entity: any) => {
          if (entity === PropertyHistory) {
            return {
              find: jest.fn().mockResolvedValue(phStore),
              update: jest.fn(),
              createQueryBuilder: jest.fn().mockImplementation(() => ({
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                getOne: jest.fn().mockResolvedValue(null),
              })),
            };
          }
          if (entity === Rent) {
            return {
              find: jest.fn().mockResolvedValue(rentStore),
              findOne: jest.fn().mockResolvedValue(null),
              save: jest.fn(),
              create: jest.fn(),
              createQueryBuilder: jest.fn().mockImplementation(() => ({
                where: jest.fn().mockReturnThis(),
                andWhere: jest.fn().mockReturnThis(),
                // Simulate an overlapping ACTIVE rent the attach just created
                getOne: jest
                  .fn()
                  .mockResolvedValue({ id: 'rent-active-1' }),
              })),
            };
          }
          return {};
        }),
      } as unknown as EntityManager;

      await expect(
        service.replayStagedApplicantHistory(
          'app-1',
          'tenant-1',
          'landlord-1',
          'prop-1',
          manager,
        ),
      ).rejects.toMatchObject({
        status: HttpStatus.CONFLICT,
        response: expect.objectContaining({
          code: 'STAGED_TENANCY_CLASH',
          stagedHistoryId: 'ph-clash',
        }),
      });
    });

    it('is idempotent — a second run finds nothing (rows already re-tagged)', async () => {
      const { manager } = makeManagerMock([]); // no staged rows

      const result = await service.replayStagedApplicantHistory(
        'app-1',
        'tenant-1',
        'landlord-1',
        'prop-1',
        manager,
      );

      expect(result.tenanciesReplayed).toBe(0);
      expect(result.paymentsReplayed).toBe(0);
      expect(tenantBalancesService.applyChange).not.toHaveBeenCalled();
    });
  });
});
