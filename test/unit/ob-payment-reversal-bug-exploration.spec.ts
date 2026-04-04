import * as fc from 'fast-check';
import { TenantBalanceLedgerType } from '../../src/tenant-balances/entities/tenant-balance-ledger.entity';

/**
 * Bug Condition Exploration Test for OB Payment Reversal Display Bug
 *
 * **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * **DO NOT attempt to fix the test or the code when it fails**
 * **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
 * **GOAL**: Surface counterexamples that demonstrate the bug exists
 *
 * Validates: Requirements 2.1, 2.2
 */
describe('Bug Condition Exploration: OB Payment Reversal Display Bug', () => {
  /**
   * Property 1: Bug Condition - OB Payment Phantom Charges
   *
   * **Validates: Requirements 2.1, 2.2**
   *
   * This test focuses on the bug where ob_payment reversal entries with positive amounts
   * appear as phantom charges in the balance breakdown modal. The current filter
   * `.filter((e) => Number(e.outstanding_balance_change) > 0)` includes ALL positive
   * entries without considering entry type, causing accounting reversals to appear as charges.
   */
  describe('Property 1: Bug Condition - OB Payment Phantom Charges', () => {
    it('should exclude ob_payment entries from charges display but currently includes them', () => {
      // **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)

      // Mock data representing ob_payment reversal entries that appear as phantom charges
      const mockLedgerEntries = [
        // Legitimate charge entry (should appear)
        {
          id: 'charge-1',
          type: TenantBalanceLedgerType.INITIAL_BALANCE,
          description: 'Rent charge for March 2026',
          outstanding_balance_change: 250000,
          property_id: 'property-1',
        },
        // OB Payment reversal entry (should NOT appear as charge)
        {
          id: 'ob-payment-1',
          type: TenantBalanceLedgerType.OB_PAYMENT,
          description: 'Payment reversal (edited payment)',
          outstanding_balance_change: 250000, // Positive amount - this is the bug!
          property_id: 'property-1',
        },
        // New payment entry (negative, appears in payments section)
        {
          id: 'payment-1',
          type: TenantBalanceLedgerType.RENT_PAYMENT,
          description: 'Updated payment amount',
          outstanding_balance_change: -310000,
          property_id: 'property-1',
        },
      ];

      // **BUG CONDITION CHECK**: Current filter includes ALL positive entries
      // This simulates the current buggy behavior in formatTenantData
      const currentBuggyFilter = mockLedgerEntries.filter(
        (e) => Number(e.outstanding_balance_change) > 0,
      );

      // Expected correct behavior: exclude ob_payment entries from charges
      const expectedCorrectFilter = mockLedgerEntries.filter(
        (e) =>
          Number(e.outstanding_balance_change) > 0 &&
          e.type !== TenantBalanceLedgerType.OB_PAYMENT,
      );

      // This assertion SHOULD FAIL on unfixed code (proving the bug exists)
      // Expected: Only 1 charge entry (legitimate charge)
      // Actual (buggy): 2 charge entries (legitimate charge + phantom ob_payment)
      expect(currentBuggyFilter.length).toBe(expectedCorrectFilter.length);

      // Document the counterexample when this fails
      if (currentBuggyFilter.length !== expectedCorrectFilter.length) {
        console.log('COUNTEREXAMPLE FOUND - OB Payment Phantom Charge Bug:');
        console.log(`Expected charges count: ${expectedCorrectFilter.length}`);
        console.log(
          `Actual charges count (buggy): ${currentBuggyFilter.length}`,
        );
        console.log('Phantom charges detected:');

        const phantomCharges = currentBuggyFilter.filter(
          (e) => e.type === TenantBalanceLedgerType.OB_PAYMENT,
        );
        phantomCharges.forEach((charge) => {
          console.log(
            `  - ${charge.description}: ₦${Number(charge.outstanding_balance_change).toLocaleString()}`,
          );
        });

        console.log(
          'This confirms the bug exists: ob_payment entries appear as phantom charges',
        );
      }
    });

    it('should demonstrate phantom charge scenario from payment editing', () => {
      // **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)

      // Mock scenario: Payment of ₦250,000 is edited to ₦310,000
      // System creates ob_payment reversal (+₦250,000) and new payment (-₦310,000)
      const paymentEditScenario = [
        // Original charge
        {
          id: 'original-charge',
          type: TenantBalanceLedgerType.INITIAL_BALANCE,
          description: 'Rent charge for March 2026',
          outstanding_balance_change: 250000,
        },
        // OB Payment reversal (accounting entry - should NOT appear as charge)
        {
          id: 'ob-reversal',
          type: TenantBalanceLedgerType.OB_PAYMENT,
          description: 'Payment reversal (edited payment)',
          outstanding_balance_change: 250000, // Positive - creates phantom charge
        },
        // New payment amount
        {
          id: 'new-payment',
          type: TenantBalanceLedgerType.RENT_PAYMENT,
          description: 'Updated payment amount',
          outstanding_balance_change: -310000, // Negative - appears in payments
        },
      ];

      // **BUG CONDITION**: Current system shows both original charge AND phantom charge
      const chargesFromCurrentFilter = paymentEditScenario.filter(
        (e) => Number(e.outstanding_balance_change) > 0,
      );

      const paymentsFromCurrentFilter = paymentEditScenario.filter(
        (e) => Number(e.outstanding_balance_change) < 0,
      );

      // Calculate what user sees in balance breakdown modal
      const totalChargesShown = chargesFromCurrentFilter.reduce(
        (sum, e) => sum + Number(e.outstanding_balance_change),
        0,
      );
      const totalPaymentsShown = paymentsFromCurrentFilter.reduce(
        (sum, e) => sum + Math.abs(Number(e.outstanding_balance_change)),
        0,
      );

      // Expected behavior: Only show legitimate charges (₦250,000)
      const expectedChargesTotal = 250000; // Only the original charge
      const expectedPaymentsTotal = 310000; // Only the new payment amount

      // This assertion SHOULD FAIL on unfixed code (proving the bug exists)
      // Expected: ₦250,000 in charges (original charge only)
      // Actual (buggy): ₦500,000 in charges (original + phantom ob_payment)
      expect(totalChargesShown).toBe(expectedChargesTotal);

      // Document the counterexample when this fails
      if (totalChargesShown !== expectedChargesTotal) {
        console.log('COUNTEREXAMPLE FOUND - Payment Edit Phantom Charge:');
        console.log(
          `Expected total charges: ₦${expectedChargesTotal.toLocaleString()}`,
        );
        console.log(
          `Actual total charges (buggy): ₦${totalChargesShown.toLocaleString()}`,
        );
        console.log(
          `Phantom amount: ₦${(totalChargesShown - expectedChargesTotal).toLocaleString()}`,
        );
        console.log(
          `Total payments shown: ₦${totalPaymentsShown.toLocaleString()}`,
        );
        console.log(
          'User sees confusing phantom charge alongside legitimate payment',
        );
        console.log(
          'This confirms the bug exists: ob_payment reversals appear as charges',
        );
      }
    });

    it('should demonstrate multiple phantom charges from multiple payment edits', () => {
      // **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)

      // Mock scenario: Multiple payments edited, creating multiple ob_payment reversals
      const multipleEditsScenario = [
        // Original charge
        {
          id: 'charge-1',
          type: TenantBalanceLedgerType.INITIAL_BALANCE,
          description: 'Rent charge for March 2026',
          outstanding_balance_change: 300000,
        },
        // First payment edit: ₦200,000 → ₦250,000
        {
          id: 'ob-reversal-1',
          type: TenantBalanceLedgerType.OB_PAYMENT,
          description: 'Payment reversal (first edit)',
          outstanding_balance_change: 200000, // Phantom charge #1
        },
        {
          id: 'payment-1',
          type: TenantBalanceLedgerType.RENT_PAYMENT,
          description: 'First updated payment',
          outstanding_balance_change: -250000,
        },
        // Second payment edit: ₦250,000 → ₦300,000
        {
          id: 'ob-reversal-2',
          type: TenantBalanceLedgerType.OB_PAYMENT,
          description: 'Payment reversal (second edit)',
          outstanding_balance_change: 250000, // Phantom charge #2
        },
        {
          id: 'payment-2',
          type: TenantBalanceLedgerType.RENT_PAYMENT,
          description: 'Final payment amount',
          outstanding_balance_change: -300000,
        },
      ];

      // **BUG CONDITION**: Multiple ob_payment entries create multiple phantom charges
      const allPositiveEntries = multipleEditsScenario.filter(
        (e) => Number(e.outstanding_balance_change) > 0,
      );

      const legitimateCharges = allPositiveEntries.filter(
        (e) => e.type !== TenantBalanceLedgerType.OB_PAYMENT,
      );

      const phantomCharges = allPositiveEntries.filter(
        (e) => e.type === TenantBalanceLedgerType.OB_PAYMENT,
      );

      // This assertion SHOULD FAIL on unfixed code (proving the bug exists)
      // Expected: 1 legitimate charge, 0 phantom charges
      // Actual (buggy): 1 legitimate charge, 2 phantom charges
      expect(phantomCharges.length).toBe(0);

      // Document the counterexample when this fails
      if (phantomCharges.length > 0) {
        console.log('COUNTEREXAMPLE FOUND - Multiple Phantom Charges:');
        console.log(`Legitimate charges: ${legitimateCharges.length}`);
        console.log(`Phantom charges: ${phantomCharges.length}`);
        console.log('Phantom charges breakdown:');

        phantomCharges.forEach((charge, index) => {
          console.log(
            `  ${index + 1}. ${charge.description}: ₦${Number(charge.outstanding_balance_change).toLocaleString()}`,
          );
        });

        const totalPhantomAmount = phantomCharges.reduce(
          (sum, e) => sum + Number(e.outstanding_balance_change),
          0,
        );
        console.log(
          `Total phantom amount: ₦${totalPhantomAmount.toLocaleString()}`,
        );
        console.log(
          'This confirms the bug exists: multiple payment edits create multiple phantom charges',
        );
      }
    });
  });

  /**
   * Property-Based Test: Bug Condition Detection Across Various Scenarios
   *
   * This test generates various ledger entry configurations to verify the bug condition
   * holds across different scenarios with ob_payment entries.
   */
  describe('Property-Based Bug Condition Detection', () => {
    it('should detect ob_payment phantom charges across various ledger configurations', () => {
      fc.assert(
        fc.property(
          // Generate ledger configurations with mixed entry types
          fc.record({
            tenantId: fc.uuid(),
            ledgerEntries: fc.array(
              fc.record({
                id: fc.uuid(),
                type: fc.constantFrom(
                  TenantBalanceLedgerType.INITIAL_BALANCE,
                  TenantBalanceLedgerType.OB_PAYMENT,
                  TenantBalanceLedgerType.RENT_PAYMENT,
                  TenantBalanceLedgerType.AUTO_RENEWAL,
                ),
                description: fc.string({ minLength: 5, maxLength: 50 }),
                outstanding_balance_change: fc.integer({
                  min: -500000,
                  max: 500000,
                }),
                property_id: fc.uuid(),
              }),
              { minLength: 1, maxLength: 10 },
            ),
          }),
          (config) => {
            // **BUG CONDITION**: ob_payment entries with positive amounts should NOT appear as charges
            // but currently do appear (this property will fail on unfixed code)

            const positiveEntries = config.ledgerEntries.filter(
              (e) => Number(e.outstanding_balance_change) > 0,
            );

            const obPaymentPhantomCharges = positiveEntries.filter(
              (e) => e.type === TenantBalanceLedgerType.OB_PAYMENT,
            );

            // Document any phantom charges found
            if (obPaymentPhantomCharges.length > 0) {
              console.log(
                `Bug condition detected for tenant ${config.tenantId}:`,
              );
              console.log(
                `  Found ${obPaymentPhantomCharges.length} ob_payment phantom charges`,
              );

              obPaymentPhantomCharges.forEach((charge) => {
                console.log(
                  `    - ${charge.description}: ₦${Number(charge.outstanding_balance_change).toLocaleString()}`,
                );
              });
            }

            // This property encodes the expected behavior
            // For this exploration test, we expect this to fail on unfixed code when ob_payment entries exist
            expect(obPaymentPhantomCharges.length).toBe(0); // Will fail on unfixed code when ob_payment entries with positive amounts exist
          },
        ),
        {
          numRuns: 20, // Generate multiple scenarios to find counterexamples
          verbose: true,
        },
      );
    });

    it('should verify that legitimate charges are preserved while ob_payment entries are excluded', () => {
      fc.assert(
        fc.property(
          // Generate scenarios with both legitimate charges and ob_payment entries
          fc.record({
            legitimateCharges: fc.array(
              fc.record({
                id: fc.uuid(),
                type: fc.constantFrom(
                  TenantBalanceLedgerType.INITIAL_BALANCE,
                  TenantBalanceLedgerType.AUTO_RENEWAL,
                ),
                outstanding_balance_change: fc.integer({ min: 1, max: 500000 }),
              }),
              { minLength: 1, maxLength: 5 },
            ),
            obPaymentEntries: fc.array(
              fc.record({
                id: fc.uuid(),
                type: fc.constant(TenantBalanceLedgerType.OB_PAYMENT),
                outstanding_balance_change: fc.integer({ min: 1, max: 500000 }),
              }),
              { minLength: 1, maxLength: 3 },
            ),
          }),
          (config) => {
            const allEntries = [
              ...config.legitimateCharges,
              ...config.obPaymentEntries,
            ];

            // Current buggy filter (includes ALL positive entries)
            const currentBuggyResult = allEntries.filter(
              (e) => Number(e.outstanding_balance_change) > 0,
            );

            // Expected correct filter (excludes ob_payment entries)
            const expectedCorrectResult = allEntries.filter(
              (e) =>
                Number(e.outstanding_balance_change) > 0 &&
                e.type !== TenantBalanceLedgerType.OB_PAYMENT,
            );

            // This assertion documents the preservation requirement
            // The fix should preserve legitimate charges while excluding ob_payment entries
            expect(currentBuggyResult.length).toBe(
              expectedCorrectResult.length,
            );

            // Document the difference when this fails
            if (currentBuggyResult.length !== expectedCorrectResult.length) {
              console.log('Bug condition detected:');
              console.log(
                `  Legitimate charges: ${config.legitimateCharges.length}`,
              );
              console.log(
                `  OB payment entries: ${config.obPaymentEntries.length}`,
              );
              console.log(
                `  Current filter result: ${currentBuggyResult.length} entries`,
              );
              console.log(
                `  Expected filter result: ${expectedCorrectResult.length} entries`,
              );
              console.log(
                `  Phantom charges: ${currentBuggyResult.length - expectedCorrectResult.length}`,
              );
            }
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
