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
 * Bug Condition Exploration Test for OB Payment Reversal Display Bug
 *
 * **STATUS: BUG FIXED — SPEC UPDATED TO ENCODE THE FIXED BEHAVIOR**
 *
 * The original version of this spec was written to FAIL while the bug existed:
 * it reproduced the old `.filter((e) => amount-in-charge-direction)` logic
 * against hard-coded rows and asserted the intended outcome, so a red run
 * proved that payment-edit reversal legs surfaced as phantom charges in the
 * balance breakdown modal. The product has since been fixed in
 * TenantManagementService.computeTenantBalance()
 * (src/users/tenant-management/tenant-management.service.ts):
 *
 *  - The ledger sign model was clarified: `balance_change` is a signed wallet
 *    change (negative = charge, positive = payment). OB_PAYMENT is now always
 *    a positive payment row; the charge-direction leg written when a manual
 *    payment is edited/deleted is typed OB_CHARGE (see
 *    PropertyHistoryService.handleUpdatePaymentHistoryEntry, which reverses
 *    every ledger leg tied to the property_history row and re-applies the new
 *    amount).
 *  - The charges filter excludes ALL `related_entity_type = 'property_history'`
 *    rows (edit/delete reversal artifacts), `rent_edit` reversal rows and
 *    `metadata.superseded` rows — so reversal accounting never renders as a
 *    charge. Property history itself (updated in place) is the authority for
 *    the current manual-payment amount shown in paymentTransactions.
 *
 * This spec therefore now instantiates the real service (mocked repositories /
 * collaborators, per test/unit conventions) and asserts the FIXED behavior.
 * If any of these tests regress to red, phantom charges are back.
 *
 * Validates: Requirements 2.1, 2.2
 */
describe('Bug Condition Exploration: OB Payment Reversal Display Bug', () => {
  const TENANT_ID = 'tenant-1';
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
    id: TENANT_ID,
    property_histories: propertyHistories,
  });

  const RENT = {
    id: 'rent-1',
    property_id: PROPERTY.id,
    property: PROPERTY,
    rent_start_date: new Date('2026-03-01T00:00:00Z'),
    expiry_date: new Date('2027-02-28T00:00:00Z'),
  };

  const baseEntry = (overrides) => ({
    related_entity_type: null,
    related_entity_id: null,
    created_at: new Date('2026-03-05T00:00:00Z'),
    property_id: PROPERTY.id,
    metadata: null,
    ...overrides,
  });

  const rentCharge = (id, amount, description = 'Rent charge') =>
    baseEntry({
      id,
      type: TenantBalanceLedgerType.INITIAL_BALANCE,
      description,
      balance_change: -amount, // charge = negative wallet change
      related_entity_type: 'rent',
      related_entity_id: RENT.id,
    });

  /** Charge-direction reversal leg written when a manual payment is edited. */
  const editReversalLeg = (id, amount, phId) =>
    baseEntry({
      id,
      type: TenantBalanceLedgerType.OB_CHARGE,
      description: 'Historical payment updated (reversal)',
      balance_change: -amount,
      related_entity_type: 'property_history',
      related_entity_id: phId,
    });

  /** Payment leg (original or re-applied amount) tied to a manual payment. */
  const manualPaymentLeg = (id, amount, phId) =>
    baseEntry({
      id,
      type: TenantBalanceLedgerType.OB_PAYMENT,
      description: `Manual payment of ₦${amount.toLocaleString()} received`,
      balance_change: amount,
      related_entity_type: 'property_history',
      related_entity_id: phId,
    });

  const manualPaymentHistory = (id, currentAmount) => ({
    id,
    event_type: 'user_added_payment',
    property: PROPERTY,
    // Property history is updated in place — it always holds the CURRENT amount.
    event_description: JSON.stringify({
      paymentAmount: currentAmount,
      description: 'Manual payment',
    }),
    move_in_date: new Date('2026-03-02T00:00:00Z'),
    created_at: new Date('2026-03-02T00:00:00Z'),
  });

  const allBreakdownTransactions = (result) =>
    result.outstandingBalanceBreakdown.flatMap((b) => b.transactions);

  describe('Property 1: Fixed Behavior - No OB Payment Phantom Charges', () => {
    it('excludes payment-edit reversal legs from the charges display', async () => {
      // Payment of ₦250,000 edited to ₦310,000 → reversal pair on the ledger.
      const ph = manualPaymentHistory('ph-1', 310000);
      tenantBalancesService.getLedger.mockResolvedValue([
        rentCharge('charge-1', 250000, 'Rent charge for March 2026'),
        editReversalLeg('ob-reversal-1', 250000, ph.id),
        manualPaymentLeg('new-payment-1', 310000, ph.id),
      ]);

      const result = await computeBalance(makeAccount([ph]), [RENT]);

      // FIXED: only the legitimate charge renders — the reversal leg does not.
      const charges = allBreakdownTransactions(result);
      expect(charges.map((t) => t.id)).toEqual(['charge-1']);
      expect(
        charges.some((t) => t.id === 'ob-reversal-1'),
      ).toBe(false);
    });

    it('shows the edited payment scenario without phantom charge amounts', async () => {
      // The original counterexample: user saw ₦500,000 of "charges" after
      // editing a ₦250,000 payment to ₦310,000.
      const ph = manualPaymentHistory('ph-1', 310000);
      tenantBalancesService.getLedger.mockResolvedValue([
        rentCharge('original-charge', 250000, 'Rent charge for March 2026'),
        editReversalLeg('ob-reversal', 250000, ph.id),
        manualPaymentLeg('new-payment', 310000, ph.id),
      ]);

      const result = await computeBalance(makeAccount([ph]), [RENT]);

      // FIXED: charges total the legitimate charge only (was 500,000 pre-fix).
      const totalChargesShown = result.outstandingBalanceBreakdown.reduce(
        (sum, b) => sum + b.outstandingAmount,
        0,
      );
      expect(totalChargesShown).toBe(250000);

      // The payment side shows the current amount exactly once (from the
      // in-place-updated property history), not the pre-edit ₦250,000 leg.
      expect(result.paymentTransactions).toHaveLength(1);
      expect(result.paymentTransactions[0].id).toBe('payment-history-ph-1');
      expect(result.paymentTransactions[0].amount).toBe(-310000);
    });

    it('produces no accumulating phantom charges across multiple payment edits', async () => {
      // ₦200,000 → ₦250,000 → ₦300,000: each edit reverses EVERY prior leg
      // tied to the property_history row and re-applies the new amount.
      const ph = manualPaymentHistory('ph-1', 300000);
      tenantBalancesService.getLedger.mockResolvedValue([
        rentCharge('charge-1', 300000, 'Rent charge for March 2026'),
        // original payment
        manualPaymentLeg('pay-original', 200000, ph.id),
        // first edit: reverse +200k, apply +250k
        editReversalLeg('rev-1', 200000, ph.id),
        manualPaymentLeg('pay-edit-1', 250000, ph.id),
        // second edit: reverse the three existing legs, apply +300k
        editReversalLeg('rev-2a', 200000, ph.id),
        manualPaymentLeg('rev-2b', 200000, ph.id), // reversal of rev-1 (payment direction)
        editReversalLeg('rev-2c', 250000, ph.id),
        manualPaymentLeg('pay-edit-2', 300000, ph.id),
      ]);

      const result = await computeBalance(makeAccount([ph]), [RENT]);

      // FIXED: exactly one legitimate charge, zero phantom rows.
      const charges = allBreakdownTransactions(result);
      expect(charges.map((t) => t.id)).toEqual(['charge-1']);
      expect(charges[0].amount).toBe(300000);

      // And exactly one payment row at the final amount.
      expect(result.paymentTransactions).toHaveLength(1);
      expect(result.paymentTransactions[0].amount).toBe(-300000);
    });
  });

  /**
   * Property-Based Test: Fixed Behavior Across Various Ledger Configurations
   *
   * Generates mixed ledgers (legitimate charges + edit-reversal artifacts +
   * payment legs) and asserts the real implementation never surfaces a
   * property_history reversal leg — or any positive OB_PAYMENT row — as a
   * charge, while every legitimate charge is preserved.
   */
  describe('Property-Based Fixed Behavior Detection', () => {
    it('never surfaces reversal legs or OB payments as charges across various ledger configurations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            legitimateCharges: fc.array(
              fc.record({
                amount: fc.integer({ min: 1, max: 500000 }),
                type: fc.constantFrom(
                  TenantBalanceLedgerType.INITIAL_BALANCE,
                  TenantBalanceLedgerType.AUTO_RENEWAL,
                ),
              }),
              { minLength: 1, maxLength: 5 },
            ),
            reversalArtifacts: fc.array(
              fc.record({
                amount: fc.integer({ min: 1, max: 500000 }),
                // Edits write both directions; neither may render as a charge.
                direction: fc.constantFrom(-1, 1),
              }),
              { minLength: 1, maxLength: 3 },
            ),
            obPayments: fc.array(
              fc.record({
                amount: fc.integer({ min: 1, max: 500000 }),
                relatedEntityType: fc.constantFrom(
                  'renewal_invoice',
                  'payment_plan_installment',
                  null,
                ),
              }),
              { minLength: 0, maxLength: 3 },
            ),
          }),
          async (config) => {
            const legitEntries = config.legitimateCharges.map((c, i) =>
              baseEntry({
                id: `legit-${i}`,
                type: c.type,
                description: `Charge ${i}`,
                balance_change: -c.amount,
                related_entity_type: 'rent',
                related_entity_id: RENT.id,
              }),
            );
            const reversalEntries = config.reversalArtifacts.map((r, i) =>
              baseEntry({
                id: `reversal-${i}`,
                type:
                  r.direction < 0
                    ? TenantBalanceLedgerType.OB_CHARGE
                    : TenantBalanceLedgerType.OB_PAYMENT,
                description: 'Historical payment updated (reversal)',
                balance_change: r.direction * r.amount,
                related_entity_type: 'property_history',
                related_entity_id: 'ph-1',
              }),
            );
            const paymentEntries = config.obPayments.map((p, i) =>
              baseEntry({
                id: `payment-${i}`,
                type: TenantBalanceLedgerType.OB_PAYMENT,
                description: `Payment ${i}`,
                balance_change: p.amount, // OB_PAYMENT is always positive now
                related_entity_type: p.relatedEntityType,
                related_entity_id: p.relatedEntityType ? `rel-${i}` : null,
              }),
            );
            tenantBalancesService.getLedger.mockResolvedValue([
              ...legitEntries,
              ...reversalEntries,
              ...paymentEntries,
            ]);

            const result = await computeBalance(makeAccount(), [RENT]);
            const chargeIds = allBreakdownTransactions(result).map(
              (t) => t.id,
            );

            // FIXED: no reversal artifact and no OB payment renders as a charge…
            for (const entry of [...reversalEntries, ...paymentEntries]) {
              expect(chargeIds).not.toContain(entry.id);
            }
            // …while every legitimate charge is preserved, exactly once.
            expect([...chargeIds].sort()).toEqual(
              legitEntries.map((e) => e.id).sort(),
            );
          },
        ),
        {
          numRuns: 20, // service call per run — keep the exploration cheap
          verbose: true,
        },
      );
    });

    it('preserves legitimate charge totals while reversal artifacts net to zero on display', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            legitimateCharges: fc.array(
              fc.integer({ min: 1, max: 500000 }),
              { minLength: 1, maxLength: 5 },
            ),
            editedPaymentAmounts: fc.array(
              fc.record({
                before: fc.integer({ min: 1, max: 500000 }),
                after: fc.integer({ min: 1, max: 500000 }),
              }),
              { minLength: 1, maxLength: 3 },
            ),
          }),
          async (config) => {
            const legitEntries = config.legitimateCharges.map((amount, i) =>
              baseEntry({
                id: `legit-${i}`,
                type: TenantBalanceLedgerType.INITIAL_BALANCE,
                description: `Charge ${i}`,
                balance_change: -amount,
                related_entity_type: 'rent',
                related_entity_id: RENT.id,
              }),
            );
            // Each edited payment contributes its full reversal pair plus the
            // re-applied amount — all tied to the property_history row.
            const histories = config.editedPaymentAmounts.map((p, i) =>
              manualPaymentHistory(`ph-${i}`, p.after),
            );
            const editLegs = config.editedPaymentAmounts.flatMap((p, i) => [
              manualPaymentLeg(`orig-${i}`, p.before, `ph-${i}`),
              editReversalLeg(`rev-${i}`, p.before, `ph-${i}`),
              manualPaymentLeg(`new-${i}`, p.after, `ph-${i}`),
            ]);
            tenantBalancesService.getLedger.mockResolvedValue([
              ...legitEntries,
              ...editLegs,
            ]);

            const result = await computeBalance(
              makeAccount(histories),
              [RENT],
            );

            // Displayed charges equal the legitimate charges exactly.
            const totalChargesShown =
              result.outstandingBalanceBreakdown.reduce(
                (sum, b) => sum + b.outstandingAmount,
                0,
              );
            const expectedChargesTotal = config.legitimateCharges.reduce(
              (a, b) => a + b,
              0,
            );
            expect(totalChargesShown).toBe(expectedChargesTotal);

            // Payments show each edited payment once, at its CURRENT amount.
            const expectedPaymentsTotal = config.editedPaymentAmounts.reduce(
              (sum, p) => sum + p.after,
              0,
            );
            const totalPaymentsShown = result.paymentTransactions.reduce(
              (sum, t) => sum + Math.abs(t.amount),
              0,
            );
            expect(result.paymentTransactions).toHaveLength(
              config.editedPaymentAmounts.length,
            );
            expect(totalPaymentsShown).toBe(expectedPaymentsTotal);
          },
        ),
        {
          numRuns: 15,
          verbose: true,
        },
      );
    });
  });
});
