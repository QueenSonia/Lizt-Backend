// @ts-nocheck
import * as fc from 'fast-check';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { TenantManagementService } from '../../src/users/tenant-management/tenant-management.service';
import { Users } from '../../src/users/entities/user.entity';
import { Account } from '../../src/users/entities/account.entity';
import { Rent } from '../../src/rents/entities/rent.entity';
import { PropertyTenant } from '../../src/properties/entities/property-tenants.entity';
import { KYCApplication } from '../../src/kyc-links/entities/kyc-application.entity';
import { OfferLetter } from '../../src/offer-letters/entities/offer-letter.entity';
import { Payment } from '../../src/payments/entities/payment.entity';
import { AdHocInvoiceLineItem } from '../../src/ad-hoc-invoices/entities/ad-hoc-invoice-line-item.entity';
import { UtilService } from '../../src/utils/utility-service';
import { WhatsappBotService } from '../../src/whatsapp-bot/whatsapp-bot.service';
import { TenantBalancesService } from '../../src/tenant-balances/tenant-balances.service';
import { PropertyHistoryService } from '../../src/property-history/property-history.service';
import { AccountCacheService } from '../../src/auth/account-cache.service';
import { ManagementScopeService } from '../../src/common/scope/management-scope.service';
import { TenantBalanceLedgerType } from '../../src/tenant-balances/entities/tenant-balance-ledger.entity';

/**
 * Bug Condition Exploration Test for Tenant Balance Breakdown Date and Payment Source Issues
 *
 * **STATUS: BUG FIXED — SPEC UPDATED TO ENCODE THE FIXED BEHAVIOR**
 *
 * The original version of this spec was written to FAIL while the bug existed:
 * it compared hard-coded "current buggy" values (ledger created_at used as the
 * display date, payments read only from property history, "Unknown Property"
 * for NULL property_id migration rows, one shared rent period for every row)
 * against the intended values, so a red run proved the bug. The product has
 * since been fixed in TenantManagementService.computeTenantBalance()
 * (src/users/tenant-management/tenant-management.service.ts):
 *
 *  - Rent-related charge rows resolve their date AND period label from the
 *    specific rent record via related_entity_id (rent_start_date/expiry_date),
 *    falling back to created_at only when the rent record is missing.
 *  - Payment transactions are unified: manual payments come from property
 *    history (edited in place — the authority for current amounts, dated by
 *    move_in_date), while renewal-invoice / payment-plan-installment / genuine
 *    ad-hoc payments are read from the wallet ledger. Note the shipped design
 *    deliberately does NOT sum raw reversal legs (the original spec's naive
 *    "sum every negative ledger row" oracle would double-count edited
 *    payments); reversal legs net silently and only current amounts surface.
 *  - Migration rows with NULL property_id resolve the property name from the
 *    tenant's rent records instead of rendering "Unknown Property".
 *
 * This spec therefore now instantiates the real service (mocked repositories /
 * collaborators, per test/unit conventions) and asserts the FIXED behavior.
 * If any of these tests regress to red, the display bug has been reintroduced.
 *
 * Validates: Requirements 1.1–1.8, 2.1, 2.2, 2.5
 */
describe('Bug Condition Exploration: Tenant Balance Breakdown Date and Payment Source Issues', () => {
  // Test tenant ID with known issues from the original bug report
  const TEST_TENANT_ID = '3bb32f23-f98f-4589-8728-6b1b0f73a496';
  const LANDLORD_ID = 'landlord-1';
  const PROPERTY = {
    id: 'property-1',
    name: 'Sunset Apartments Unit 5A',
    owner_id: LANDLORD_ID,
  };

  let service: TenantManagementService;

  const tenantBalancesService = {
    getBalance: jest.fn(),
    getLedger: jest.fn(),
  };
  const paymentPlanRepository = { find: jest.fn() };
  const adHocInvoiceLineItemRepository = { find: jest.fn() };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TenantManagementService,
        { provide: getRepositoryToken(Users), useValue: {} },
        { provide: getRepositoryToken(Account), useValue: {} },
        { provide: getRepositoryToken(Rent), useValue: {} },
        { provide: getRepositoryToken(PropertyTenant), useValue: {} },
        { provide: getRepositoryToken(KYCApplication), useValue: {} },
        { provide: getRepositoryToken(OfferLetter), useValue: {} },
        { provide: getRepositoryToken(Payment), useValue: {} },
        {
          provide: getRepositoryToken(AdHocInvoiceLineItem),
          useValue: adHocInvoiceLineItemRepository,
        },
        {
          provide: DataSource,
          useValue: {
            getRepository: jest.fn().mockReturnValue(paymentPlanRepository),
          },
        },
        { provide: UtilService, useValue: {} },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: WhatsappBotService, useValue: {} },
        { provide: TenantBalancesService, useValue: tenantBalancesService },
        { provide: PropertyHistoryService, useValue: {} },
        { provide: AccountCacheService, useValue: {} },
        { provide: ManagementScopeService, useValue: {} },
      ],
    }).compile();

    service = module.get(TenantManagementService);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    tenantBalancesService.getBalance.mockResolvedValue(0);
    tenantBalancesService.getLedger.mockResolvedValue([]);
    paymentPlanRepository.find.mockResolvedValue([]);
    adHocInvoiceLineItemRepository.find.mockResolvedValue([]);
  });

  /** Invoke the real (private) breakdown builder the modal endpoints use. */
  const computeBalance = (account, rents) =>
    (service as any).computeTenantBalance(account, LANDLORD_ID, rents);

  const makeAccount = (propertyHistories = []) => ({
    id: TEST_TENANT_ID,
    property_histories: propertyHistories,
  });

  const makeRent = (overrides = {}) => ({
    id: 'rent-1',
    property_id: PROPERTY.id,
    property: PROPERTY,
    rent_start_date: new Date('2026-02-12T00:00:00Z'),
    expiry_date: new Date('2026-03-11T00:00:00Z'),
    ...overrides,
  });

  // Same formatting the service uses, so the expectation is timezone-stable.
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  const periodLabel = (rent) =>
    `(${fmt(new Date(rent.rent_start_date))} - ${fmt(new Date(rent.expiry_date))})`;

  const allBreakdownTransactions = (result) =>
    result.outstandingBalanceBreakdown.flatMap((b) => b.transactions);

  describe('Property 1: Fixed Behavior - Accurate Business Date Display and Unified Payment Source', () => {
    it('shows rent_start_date instead of created_at for rent-related charge entries', async () => {
      // FIXED: the display date is resolved from the related rent record.
      const rent = makeRent();
      tenantBalancesService.getLedger.mockResolvedValue([
        {
          id: 'ledger-1',
          type: TenantBalanceLedgerType.INITIAL_BALANCE,
          description: 'Rent charge for Feb 2026',
          balance_change: -250000, // charge = negative wallet change
          related_entity_type: 'rent',
          related_entity_id: rent.id,
          created_at: new Date('2026-04-04T00:00:00Z'), // ledger write date — must NOT display
          property_id: PROPERTY.id,
          metadata: null,
        },
      ]);

      const result = await computeBalance(makeAccount(), [rent]);

      expect(result.outstandingBalanceBreakdown).toHaveLength(1);
      const [tx] = result.outstandingBalanceBreakdown[0].transactions;
      expect(tx.amount).toBe(250000);
      // Fixed behavior: business date (rent_start_date), not ledger created_at
      expect(tx.date).toEqual(new Date('2026-02-12T00:00:00Z'));
      expect(tx.date).not.toEqual(new Date('2026-04-04T00:00:00Z'));
    });

    it('unifies payment transactions: in-place property-history amount plus ledger-only payments, with reversal legs netted away', async () => {
      // Scenario from the original bug report: a manual payment edited from
      // ₦250,000 to ₦310,000 plus a renewal payment of ₦200,000 that exists
      // only on the ledger.
      const rent = makeRent();
      const manualPayment = {
        id: 'ph-1',
        event_type: 'user_added_payment',
        property: PROPERTY,
        // Property history is updated IN PLACE on edit — current amount only.
        event_description: JSON.stringify({
          paymentAmount: 310000,
          description: 'Manual payment',
        }),
        move_in_date: new Date('2026-02-15T00:00:00Z'),
        created_at: new Date('2026-04-04T00:00:00Z'),
      };
      tenantBalancesService.getLedger.mockResolvedValue([
        {
          id: 'charge-1',
          type: TenantBalanceLedgerType.INITIAL_BALANCE,
          description: 'Rent charge for Feb 2026',
          balance_change: -250000,
          related_entity_type: 'rent',
          related_entity_id: rent.id,
          created_at: new Date('2026-02-12T00:00:00Z'),
          property_id: PROPERTY.id,
          metadata: null,
        },
        // Edit reversal pair — accounting artifacts, must surface NOWHERE:
        {
          id: 'edit-reversal',
          type: TenantBalanceLedgerType.OB_CHARGE,
          description: 'Historical payment updated (reversal)',
          balance_change: -250000,
          related_entity_type: 'property_history',
          related_entity_id: manualPayment.id,
          created_at: new Date('2026-04-04T00:00:00Z'),
          property_id: PROPERTY.id,
          metadata: null,
        },
        {
          id: 'edit-new-amount',
          type: TenantBalanceLedgerType.OB_PAYMENT,
          description: 'Manual payment of ₦310,000 received',
          balance_change: 310000,
          related_entity_type: 'property_history',
          related_entity_id: manualPayment.id,
          created_at: new Date('2026-04-04T00:00:00Z'),
          property_id: PROPERTY.id,
          metadata: null,
        },
        // Renewal payment — exists only on the ledger, must be included:
        {
          id: 'renewal-pay-1',
          type: TenantBalanceLedgerType.OB_PAYMENT,
          description: 'Renewal invoice payment',
          balance_change: 200000,
          related_entity_type: 'renewal_invoice',
          related_entity_id: 'ri-1',
          created_at: new Date('2026-03-20T00:00:00Z'),
          property_id: PROPERTY.id,
          metadata: null,
        },
      ]);

      const result = await computeBalance(makeAccount([manualPayment]), [
        rent,
      ]);

      // Both payment sources are represented…
      const manualRow = result.paymentTransactions.find(
        (t) => t.id === 'payment-history-ph-1',
      );
      const renewalRow = result.paymentTransactions.find(
        (t) => t.id === 'renewal-pay-1',
      );
      expect(manualRow).toBeDefined();
      expect(manualRow.amount).toBe(-310000); // current (edited) amount, once
      expect(renewalRow).toBeDefined();
      expect(renewalRow.amount).toBe(-200000); // ledger-only renewal payment
      expect(result.paymentTransactions).toHaveLength(2);

      // …and total money received reflects both, without reversal-leg noise.
      const totalPayments = result.paymentTransactions.reduce(
        (sum, t) => sum + Math.abs(t.amount),
        0,
      );
      expect(totalPayments).toBe(510000);

      // The reversal pair must not leak into the charges side either.
      const chargeIds = allBreakdownTransactions(result).map((t) => t.id);
      expect(chargeIds).toEqual(['charge-1']);
    });

    it('shows the correct property name instead of "Unknown Property" for NULL-property migration entries', async () => {
      // FIXED: NULL property_id (migration) rows resolve the property name
      // from the tenant's rent records.
      const rent = makeRent();
      tenantBalancesService.getLedger.mockResolvedValue([
        {
          id: 'migration-1',
          type: TenantBalanceLedgerType.MIGRATION,
          description: 'Migration balance',
          balance_change: -100000,
          related_entity_type: null,
          related_entity_id: null,
          created_at: new Date('2026-01-15T00:00:00Z'),
          property_id: null, // the condition that used to render "Unknown Property"
          property: null,
          metadata: null,
        },
      ]);

      const result = await computeBalance(makeAccount(), [rent]);

      expect(result.outstandingBalanceBreakdown).toHaveLength(1);
      const row = result.outstandingBalanceBreakdown[0];
      expect(row.propertyName).toBe('Sunset Apartments Unit 5A');
      expect(row.propertyName).not.toBe('Unknown Property');
      // Migration rows are normalized to the shared historical-charge label.
      expect(row.transactions[0].type).toBe('Historical tenancy recorded');
    });

    it('shows the actual payment date (property history move_in_date) instead of ledger created_at', async () => {
      const rent = makeRent();
      const manualPayment = {
        id: 'ph-1',
        event_type: 'user_added_payment',
        property: PROPERTY,
        event_description: JSON.stringify({
          paymentAmount: 310000,
          paymentDate: '2026-02-15T00:00:00Z',
        }),
        move_in_date: new Date('2026-02-15T00:00:00Z'), // actual payment date
        created_at: new Date('2026-04-04T00:00:00Z'), // record write date
      };

      const result = await computeBalance(makeAccount([manualPayment]), [
        rent,
      ]);

      expect(result.paymentTransactions).toHaveLength(1);
      const [payment] = result.paymentTransactions;
      expect(payment.date).toEqual(new Date('2026-02-15T00:00:00Z'));
      expect(payment.date).not.toEqual(new Date('2026-04-04T00:00:00Z'));
      expect(payment.amount).toBe(-310000);
    });

    it('shows each transaction with its own specific rent period, not one shared period', async () => {
      const rentA = makeRent({
        id: 'rent-1',
        rent_start_date: new Date('2026-02-12T00:00:00Z'),
        expiry_date: new Date('2026-03-11T00:00:00Z'),
      });
      const rentB = makeRent({
        id: 'rent-2',
        rent_start_date: new Date('2026-03-12T00:00:00Z'),
        expiry_date: new Date('2026-04-11T00:00:00Z'),
      });
      tenantBalancesService.getLedger.mockResolvedValue([
        {
          id: 'ledger-1',
          type: TenantBalanceLedgerType.INITIAL_BALANCE,
          description: 'Rent charge for Feb 2026',
          balance_change: -250000,
          related_entity_type: 'rent',
          related_entity_id: rentA.id,
          created_at: new Date('2026-04-04T00:00:00Z'),
          property_id: PROPERTY.id,
          metadata: null,
        },
        {
          id: 'ledger-2',
          type: TenantBalanceLedgerType.AUTO_RENEWAL,
          description: 'Rent charge for Mar 2026',
          balance_change: -250000,
          related_entity_type: 'rent',
          related_entity_id: rentB.id,
          created_at: new Date('2026-04-04T00:00:00Z'),
          property_id: PROPERTY.id,
          metadata: null,
        },
      ]);

      const result = await computeBalance(makeAccount(), [rentA, rentB]);

      const transactions = allBreakdownTransactions(result);
      expect(transactions).toHaveLength(2);
      const byId = Object.fromEntries(transactions.map((t) => [t.id, t]));
      expect(byId['ledger-1'].type).toBe(
        `Rent charge for Feb 2026 ${periodLabel(rentA)}`,
      );
      expect(byId['ledger-2'].type).toBe(
        `Rent charge for Mar 2026 ${periodLabel(rentB)}`,
      );
      // The two rows must NOT share one period label (the original bug).
      expect(byId['ledger-1'].type).not.toBe(byId['ledger-2'].type);
      // And each row is dated by its own rent period start.
      expect(byId['ledger-1'].date).toEqual(rentA.rent_start_date);
      expect(byId['ledger-2'].date).toEqual(rentB.rent_start_date);
    });
  });

  /**
   * Property-Based Test: Fixed Behavior Across Multiple Tenant Configurations
   *
   * Generates varied rent/ledger configurations and asserts the real
   * implementation always dates rent-related charge rows by the related
   * rent record's rent_start_date — never by the ledger row's created_at.
   */
  describe('Property-Based Fixed Behavior Detection', () => {
    it('always uses the related rent record dates across various tenant configurations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            rentStartDates: fc.array(
              fc.date({
                min: new Date('2026-01-01'),
                max: new Date('2026-02-28'),
                noInvalidDate: true,
              }),
              { minLength: 1, maxLength: 3 },
            ),
            entrySeeds: fc.array(
              fc.record({
                createdAt: fc.date({
                  min: new Date('2026-03-01'),
                  max: new Date('2026-04-30'),
                  noInvalidDate: true,
                }),
                amount: fc.integer({ min: 100000, max: 500000 }),
                type: fc.constantFrom(
                  TenantBalanceLedgerType.INITIAL_BALANCE,
                  TenantBalanceLedgerType.AUTO_RENEWAL,
                ),
              }),
              { minLength: 1, maxLength: 5 },
            ),
          }),
          async (config) => {
            const rents = config.rentStartDates.map((start, i) =>
              makeRent({
                id: `rent-${i}`,
                rent_start_date: start,
                expiry_date: new Date('2026-12-31T00:00:00Z'),
              }),
            );
            const ledgerEntries = config.entrySeeds.map((seed, i) => ({
              id: `charge-${i}`,
              type: seed.type,
              description: `Rent charge ${i}`,
              balance_change: -seed.amount,
              related_entity_type: 'rent',
              related_entity_id: rents[i % rents.length].id,
              created_at: seed.createdAt,
              property_id: PROPERTY.id,
              metadata: null,
            }));
            tenantBalancesService.getLedger.mockResolvedValue(ledgerEntries);

            const result = await computeBalance(makeAccount(), rents);
            const transactions = allBreakdownTransactions(result);
            expect(transactions).toHaveLength(ledgerEntries.length);

            for (const tx of transactions) {
              const entry = ledgerEntries.find((e) => e.id === tx.id);
              const rent = rents.find((r) => r.id === entry.related_entity_id);
              // Fixed behavior: the display date is the rent period start…
              expect(tx.date.getTime()).toBe(
                new Date(rent.rent_start_date).getTime(),
              );
              // …and never falls back to created_at when the rent exists
              // (generator ranges guarantee the two dates differ).
              expect(tx.date.getTime()).not.toBe(entry.created_at.getTime());
              expect(tx.amount).toBe(-Number(entry.balance_change));
            }
          },
        ),
        {
          numRuns: 10, // service call per run — keep the exploration cheap
          verbose: true,
        },
      );
    });
  });
});
