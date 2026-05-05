import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { PropertyHistoryService } from '../../src/property-history/property-history.service';
import { PropertyHistory } from '../../src/property-history/entities/property-history.entity';
import { Property } from '../../src/properties/entities/property.entity';
import { Rent } from '../../src/rents/entities/rent.entity';
import { TenantBalanceLedger } from '../../src/tenant-balances/entities/tenant-balance-ledger.entity';
import { TenantBalancesService } from '../../src/tenant-balances/tenant-balances.service';
import { NotificationService } from '../../src/notifications/notification.service';
import { EventsGateway } from '../../src/events/events.gateway';
import { KYCApplication } from '../../src/kyc-links/entities/kyc-application.entity';

type MockRepository = Partial<Record<keyof Repository<any>, jest.Mock>>;

describe('PropertyHistoryService — payment receipt mint', () => {
  let service: PropertyHistoryService;
  let propertyHistoryRepo: MockRepository;
  let propertyRepo: MockRepository;
  let rentRepo: MockRepository;
  let ledgerRepo: MockRepository;
  let kycAppRepo: MockRepository;
  let tenantBalancesService: { applyChange: jest.Mock };

  beforeEach(async () => {
    const createMock = (): MockRepository => ({
      save: jest.fn(),
      findOne: jest.fn(),
      find: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
      createQueryBuilder: jest.fn().mockImplementation(() => ({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
        getMany: jest.fn().mockResolvedValue([]),
      })),
    });

    propertyHistoryRepo = createMock();
    propertyRepo = createMock();
    rentRepo = createMock();
    ledgerRepo = createMock();
    kycAppRepo = createMock();

    // syncRentPaymentStatus runs at the end of payment create/update and
    // needs both repos to return arrays.
    propertyHistoryRepo.find!.mockResolvedValue([]);
    rentRepo.find!.mockResolvedValue([]);
    ledgerRepo.find!.mockResolvedValue([]);

    tenantBalancesService = {
      applyChange: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropertyHistoryService,
        {
          provide: getRepositoryToken(PropertyHistory),
          useValue: propertyHistoryRepo,
        },
        { provide: getRepositoryToken(Property), useValue: propertyRepo },
        { provide: getRepositoryToken(Rent), useValue: rentRepo },
        {
          provide: getRepositoryToken(TenantBalanceLedger),
          useValue: ledgerRepo,
        },
        {
          provide: getRepositoryToken(KYCApplication),
          useValue: kycAppRepo,
        },
        {
          provide: NotificationService,
          useValue: { create: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: EventsGateway,
          useValue: { emitHistoryAdded: jest.fn() },
        },
        { provide: TenantBalancesService, useValue: tenantBalancesService },
      ],
    }).compile();

    service = module.get<PropertyHistoryService>(PropertyHistoryService);
  });

  describe('create-time mint', () => {
    it('tenant-mode payment mints receipt_token + receipt_number with PHR- prefix', async () => {
      propertyRepo.findOne!.mockResolvedValue({
        id: 'prop-1',
        owner_id: 'landlord-1',
      });
      let savedRow: any = null;
      propertyHistoryRepo.save!.mockImplementation(async (data: any) => {
        savedRow = { id: 'ph-1', ...data };
        return savedRow;
      });

      await service.createPropertyHistory({
        property_id: 'prop-1',
        tenant_id: 'tenant-1',
        event_type: 'user_added_payment',
        event_description: JSON.stringify({ paymentAmount: 25000 }),
        move_in_date: '2026-01-15',
      });

      expect(savedRow.receipt_token).toMatch(/^receipt_\d+_[a-f0-9]{8}$/);
      expect(savedRow.receipt_number).toMatch(/^PHR-\d+$/);
    });

    it('staged-applicant payment also mints a token + number', async () => {
      kycAppRepo.findOne!.mockResolvedValue({
        id: 'app-1',
        property_id: 'prop-1',
      });
      let savedRow: any = null;
      propertyHistoryRepo.save!.mockImplementation(async (data: any) => {
        savedRow = { id: 'ph-staged', ...data };
        return savedRow;
      });

      await service.createPropertyHistory({
        property_id: 'prop-1',
        related_entity_type: 'kyc_application',
        related_entity_id: 'app-1',
        event_type: 'user_added_payment',
        event_description: JSON.stringify({ paymentAmount: 10000 }),
        move_in_date: '2026-02-01',
      });

      expect(savedRow.receipt_token).toMatch(/^receipt_\d+_[a-f0-9]{8}$/);
      expect(savedRow.receipt_number).toMatch(/^PHR-\d+$/);
    });

    it('tenancy entries do NOT mint a token (only payments get receipts)', async () => {
      propertyRepo.findOne!.mockResolvedValue({
        id: 'prop-1',
        owner_id: 'landlord-1',
      });
      let savedRow: any = null;
      propertyHistoryRepo.save!.mockImplementation(async (data: any) => {
        savedRow = { id: 'ph-2', ...data };
        return savedRow;
      });
      rentRepo.create!.mockReturnValue({});
      rentRepo.save!.mockResolvedValue({});

      await service.createPropertyHistory({
        property_id: 'prop-1',
        tenant_id: 'tenant-1',
        event_type: 'user_added_tenancy',
        event_description: JSON.stringify({ totalAmount: 100000 }),
        move_in_date: '2026-01-01',
        move_out_date: '2026-12-31',
      });

      expect(savedRow.receipt_token).toBeUndefined();
      expect(savedRow.receipt_number).toBeUndefined();
    });

    it('fee entries do NOT mint a token', async () => {
      propertyRepo.findOne!.mockResolvedValue({
        id: 'prop-1',
        owner_id: 'landlord-1',
      });
      let savedRow: any = null;
      propertyHistoryRepo.save!.mockImplementation(async (data: any) => {
        savedRow = { id: 'ph-3', ...data };
        return savedRow;
      });

      await service.createPropertyHistory({
        property_id: 'prop-1',
        tenant_id: 'tenant-1',
        event_type: 'user_added_fee',
        event_description: JSON.stringify({ feeAmount: 5000 }),
      });

      expect(savedRow.receipt_token).toBeUndefined();
      expect(savedRow.receipt_number).toBeUndefined();
    });
  });

  describe('edit + delete propagation (live regenerate model)', () => {
    it('handleUpdatePaymentHistoryEntry does NOT mint a new token', async () => {
      // Existing row already has a token from create-time mint.
      const existing = {
        id: 'ph-1',
        property_id: 'prop-1',
        tenant_id: 'tenant-1',
        event_type: 'user_added_payment',
        event_description: JSON.stringify({ paymentAmount: 25000 }),
        move_in_date: new Date('2026-01-15'),
        receipt_token: 'receipt_OLDTOKEN',
        receipt_number: 'PHR-OLD',
      };
      propertyHistoryRepo.findOne!.mockResolvedValue(existing);
      propertyRepo.findOne!.mockResolvedValue({
        id: 'prop-1',
        owner_id: 'landlord-1',
      });
      ledgerRepo.find!.mockResolvedValue([]);

      await service.updatePropertyHistoryById('ph-1', {
        event_description: JSON.stringify({ paymentAmount: 50000 }),
        move_in_date: '2026-01-15',
      });

      // The update call wrote the new payload to propertyHistoryRepo.update.
      // Inspect the patch — it must NOT include receipt_token/receipt_number,
      // so the existing token is preserved untouched.
      const calls = (propertyHistoryRepo.update as jest.Mock).mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      const patch = calls[0][1];
      expect(patch.receipt_token).toBeUndefined();
      expect(patch.receipt_number).toBeUndefined();
    });
  });
});
