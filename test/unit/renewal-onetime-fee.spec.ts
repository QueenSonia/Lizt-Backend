import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { RenewalChargeService } from '../../src/renewal-letters/renewal-charge.service';
import { TenantBalanceLedger } from '../../src/tenant-balances/entities/tenant-balance-ledger.entity';
import { TenantBalancesService } from '../../src/tenant-balances/tenant-balances.service';
import { Rent } from '../../src/rents/entities/rent.entity';
import {
  RenewalInvoice,
  RenewalLetterStatus,
} from '../../src/tenancies/entities/renewal-invoice.entity';
import { PropertyHistory } from '../../src/property-history/entities/property-history.entity';

/**
 * Service-level guard for the one-time-fee renewal fix. The aggregator test in
 * renewal-coverage.spec.ts proves sumAll vs sumRecurring at the math level;
 * this proves the actual RenewalChargeService methods bill the LETTER's full
 * fee set (recurring + one-time) — so a regression that re-adds a
 * `.filter(f => f.recurring)` to a letter-sourced path fails here.
 *
 * Scenario fees: rent 200k (recurring), service 50k (recurring), legal 30k
 * (ONE-TIME — a fee the landlord added in "Edit next period").
 *   sumAll = 280k, sumRecurring = 250k.
 */
describe('RenewalChargeService — one-time fee billing', () => {
  let service: RenewalChargeService;
  let tenantBalances: { applyChange: jest.Mock; getBalance: jest.Mock };
  let ledgerRepo: { find: jest.Mock };
  let rentRepo: {
    update: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
  };
  let renewalInvoiceRepo: { save: jest.Mock };
  let propertyHistoryRepo: { create: jest.Mock; save: jest.Mock };

  const RENT = 200_000;
  const SERVICE = 50_000;
  const ONE_TIME_LEGAL = 30_000;

  const feeBreakdown = () => [
    { kind: 'rent', label: 'Rent', amount: RENT, recurring: true },
    { kind: 'service', label: 'Service Charge', amount: SERVICE, recurring: true },
    { kind: 'legal', label: 'Legal Fee', amount: ONE_TIME_LEGAL, recurring: false },
  ];

  const buildLetter = (overrides: Partial<RenewalInvoice> = {}): RenewalInvoice =>
    ({
      id: 'letter-1',
      tenant_id: 'tenant-1',
      property_id: 'prop-1',
      superseded_by_id: null,
      letter_status: RenewalLetterStatus.ACCEPTED,
      payment_status: 'unpaid',
      start_date: '2026-02-01',
      end_date: '2027-01-31',
      rent_amount: RENT,
      service_charge: SERVICE,
      legal_fee: ONE_TIME_LEGAL,
      payment_frequency: 'yearly',
      fee_breakdown: feeBreakdown(),
      ...overrides,
    }) as unknown as RenewalInvoice;

  const buildRent = (overrides: Partial<Rent> = {}): Rent =>
    ({
      id: 'rent-1',
      tenant_id: 'tenant-1',
      property_id: 'prop-1',
      // expiry in the past so the OB charge fires immediately.
      expiry_date: '2020-01-01',
      rental_price: RENT,
      payment_frequency: 'yearly',
      // The OLD rent flags legal as recurring — proving the new code sources
      // the flag from the LETTER (one-time), not the carried old-rent flag.
      service_charge_recurring: true,
      legal_fee_recurring: true,
      property: { owner_id: 'landlord-1' },
      ...overrides,
    }) as unknown as Rent;

  beforeEach(async () => {
    tenantBalances = {
      applyChange: jest.fn().mockResolvedValue({}),
      getBalance: jest.fn().mockResolvedValue(-280_000), // owing → no auto-settle
    };
    ledgerRepo = { find: jest.fn().mockResolvedValue([]) }; // no existing charge
    rentRepo = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
    };
    renewalInvoiceRepo = { save: jest.fn(async (v: unknown) => v) };
    propertyHistoryRepo = {
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RenewalChargeService,
        { provide: getRepositoryToken(TenantBalanceLedger), useValue: ledgerRepo },
        { provide: getRepositoryToken(Rent), useValue: rentRepo },
        { provide: getRepositoryToken(RenewalInvoice), useValue: renewalInvoiceRepo },
        { provide: getRepositoryToken(PropertyHistory), useValue: propertyHistoryRepo },
        { provide: TenantBalancesService, useValue: tenantBalances },
      ],
    }).compile();

    service = module.get(RenewalChargeService);
  });

  describe('chargeAcceptedRenewalAtExpiry', () => {
    it('posts an OB_CHARGE for EVERY letter fee, including the one-time legal fee', async () => {
      const result = await service.chargeAcceptedRenewalAtExpiry(
        buildLetter(),
        buildRent(),
      );

      // One entry per fee — rent, service AND the one-time legal.
      expect(result.posted).toBe(3);
      expect(tenantBalances.applyChange).toHaveBeenCalledTimes(3);

      const totalDebited = tenantBalances.applyChange.mock.calls.reduce(
        (sum, call) => sum + Math.abs(Number(call[2])),
        0,
      );
      expect(totalDebited).toBe(RENT + SERVICE + ONE_TIME_LEGAL); // sumAll = 280k

      // The one-time legal fee specifically must have been charged.
      const legalCharged = tenantBalances.applyChange.mock.calls.some(
        (call) => Math.abs(Number(call[2])) === ONE_TIME_LEGAL,
      );
      expect(legalCharged).toBe(true);
    });

    it('posts for a letter whose ONLY fee is one-time (no longer skipped)', async () => {
      const letter = buildLetter({
        fee_breakdown: [
          { kind: 'legal', label: 'Legal Fee', amount: ONE_TIME_LEGAL, recurring: false },
        ],
      } as unknown as Partial<RenewalInvoice>);

      const result = await service.chargeAcceptedRenewalAtExpiry(letter, buildRent());

      expect(result.skipped).toBeUndefined();
      expect(result.posted).toBe(1);
      expect(tenantBalances.applyChange).toHaveBeenCalledTimes(1);
    });

    it('skips an already-PAID letter — never re-charges a settled renewal (2026-06-30 phantom-debt guard)', async () => {
      const result = await service.chargeAcceptedRenewalAtExpiry(
        buildLetter({ payment_status: 'paid' } as Partial<RenewalInvoice>),
        buildRent(),
      );

      expect(result.skipped).toBe('already_paid');
      expect(result.posted).toBe(0);
      expect(tenantBalances.applyChange).not.toHaveBeenCalled();
    });

    it('skips when this exact period was already billed by a new_period auto-renewal charge', async () => {
      // A monthly roll-forward already debited the wallet for this period.
      ledgerRepo.find.mockResolvedValue([
        {
          type: 'auto_renewal',
          balance_change: -RENT,
          metadata: {
            kind: 'new_period',
            period_start: '2026-02-01',
            period_end: '2027-01-31',
          },
        },
      ]);

      const result = await service.chargeAcceptedRenewalAtExpiry(
        buildLetter(), // unpaid, same period as the auto_renewal above
        buildRent(),
      );

      expect(result.skipped).toBe('period_already_charged');
      expect(result.posted).toBe(0);
      expect(tenantBalances.applyChange).not.toHaveBeenCalled();
    });

    it('skips with no_fees when the letter has no fees at all', async () => {
      const letter = buildLetter({
        rent_amount: 0,
        service_charge: 0,
        legal_fee: 0,
        fee_breakdown: [],
      } as unknown as Partial<RenewalInvoice>);

      const result = await service.chargeAcceptedRenewalAtExpiry(letter, buildRent());

      expect(result.skipped).toBe('no_fees');
      expect(result.posted).toBe(0);
      expect(tenantBalances.applyChange).not.toHaveBeenCalled();
    });
  });

  describe('renewOneFromWalletCredit (letter path)', () => {
    it('debits the FULL period (sumAll incl. one-time) from the wallet', async () => {
      await service.renewOneFromWalletCredit(
        buildRent(),
        buildLetter(),
        new Date('2026-02-01'),
        'cron',
      );

      const totalDebited = tenantBalances.applyChange.mock.calls.reduce(
        (sum, call) => sum + Math.abs(Number(call[2])),
        0,
      );
      expect(totalDebited).toBe(RENT + SERVICE + ONE_TIME_LEGAL); // 280k, not 250k
    });

    it('stores the one-time fee on the new rent with recurring=FALSE (no re-bill leak)', async () => {
      await service.renewOneFromWalletCredit(
        buildRent(), // old rent flags legal as recurring=true
        buildLetter(), // letter flags legal as one-time
        new Date('2026-02-01'),
        'cron',
      );

      // The new rent row created for the next period.
      const newRent = rentRepo.create.mock.calls[0][0];
      // Flag must come from the LETTER (one-time), not the carried old-rent flag.
      expect(newRent.legal_fee_recurring).toBe(false);
      // Recurring service stays recurring.
      expect(newRent.service_charge_recurring).toBe(true);
    });
  });
});
