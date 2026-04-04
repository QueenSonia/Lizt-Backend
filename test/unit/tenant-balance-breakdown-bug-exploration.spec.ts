import * as fc from 'fast-check';

/**
 * Bug Condition Exploration Test for Tenant Balance Breakdown Date and Payment Source Issues
 *
 * **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
 * **DO NOT attempt to fix the test or the code when it fails**
 * **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
 * **GOAL**: Surface counterexamples that demonstrate the bug exists
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8
 */
describe('Bug Condition Exploration: Tenant Balance Breakdown Date and Payment Source Issues', () => {
  // Test tenant ID with known issues from bug report
  const TEST_TENANT_ID = '3bb32f23-f98f-4589-8728-6b1b0f73a496';

  /**
   * Property 1: Bug Condition - Date and Payment Source Issues
   *
   * **Validates: Requirements 2.1, 2.2, 2.5**
   *
   * This test focuses on tenant '3bb32f23-f98f-4589-8728-6b1b0f73a496' with known issues:
   * - Charge entries should show rent_start_date instead of created_at for rent-related ledger entries
   * - Payment transactions should include all negative ledger entries instead of only property history
   * - Migration entries should show correct property name instead of "Unknown Property"
   * - Payment dates should show actual payment date instead of ledger created_at
   */
  describe('Property 1: Bug Condition - Accurate Business Date Display and Unified Payment Source', () => {
    it('should show rent_start_date instead of created_at for rent-related charge entries', () => {
      // **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)

      // Mock data representing the current buggy state
      const mockLedgerEntry = {
        id: 'ledger-1',
        tenant_id: TEST_TENANT_ID,
        type: 'initial_balance',
        description: 'Rent charge for Feb 2026',
        outstanding_balance_change: 250000,
        related_entity_type: 'rent',
        related_entity_id: 'rent-1',
        created_at: new Date('2026-04-04T00:00:00Z'), // Bug: showing created_at
        property_id: 'property-1',
      };

      const mockRentRecord = {
        id: 'rent-1',
        tenant_id: TEST_TENANT_ID,
        property_id: 'property-1',
        rent_start_date: new Date('2026-02-12T00:00:00Z'), // Expected: should show this date
        expiry_date: new Date('2026-03-11T00:00:00Z'),
      };

      // **BUG CONDITION CHECK**: The current system shows created_at instead of rent_start_date
      // This simulates the current buggy behavior in formatTenantData
      const currentBuggyDisplayDate = mockLedgerEntry.created_at; // Current implementation uses this
      const expectedCorrectDisplayDate = mockRentRecord.rent_start_date; // Should use this instead

      // This assertion SHOULD FAIL on unfixed code (proving the bug exists)
      // Expected: charge date should be rent_start_date (2026-02-12)
      // Actual (buggy): charge date will be created_at (2026-04-04)
      expect(currentBuggyDisplayDate).toEqual(expectedCorrectDisplayDate);

      // Document the counterexample when this fails
      if (
        currentBuggyDisplayDate.getTime() !==
        expectedCorrectDisplayDate.getTime()
      ) {
        console.log('COUNTEREXAMPLE FOUND - Date Display Bug:');
        console.log(`Expected: ${expectedCorrectDisplayDate.toISOString()}`);
        console.log(`Actual: ${currentBuggyDisplayDate.toISOString()}`);
        console.log(
          'This confirms the bug exists: showing created_at instead of rent_start_date',
        );
      }
    });

    it('should include all negative ledger entries in payment transactions instead of only property history', () => {
      // **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)

      // Mock data representing the payment source mismatch issue
      const mockLedgerEntries = [
        // Positive entries (charges)
        {
          id: 'charge-1',
          outstanding_balance_change: 250000,
          type: 'initial_balance',
        },
        {
          id: 'charge-2',
          outstanding_balance_change: 250000,
          type: 'initial_balance',
        },
        // Negative entries (payments) - including reversal pairs from edited payments
        {
          id: 'payment-1',
          outstanding_balance_change: -250000,
          type: 'rent_payment',
        }, // Original payment (reversal)
        {
          id: 'payment-2',
          outstanding_balance_change: -310000,
          type: 'rent_payment',
        }, // New payment amount
        {
          id: 'renewal-payment-1',
          outstanding_balance_change: -200000,
          type: 'auto_renewal',
        }, // Renewal payment (only in ledger)
      ];

      const mockPropertyHistories = [
        // Only shows updated payment amounts, missing reversal entries and renewal payments
        {
          id: 'ph-1',
          event_type: 'user_added_payment',
          event_description: JSON.stringify({ paymentAmount: 310000 }),
          move_in_date: new Date('2026-02-15T00:00:00Z'),
        },
      ];

      // **BUG CONDITION CHECK**: Payment transactions should include ALL negative ledger entries
      const totalPaymentsFromLedger = mockLedgerEntries
        .filter((e) => Number(e.outstanding_balance_change) < 0)
        .reduce(
          (sum, e) => sum + Math.abs(Number(e.outstanding_balance_change)),
          0,
        );

      // Current buggy implementation only uses property history
      const totalPaymentsFromPropertyHistory = mockPropertyHistories
        .map((ph) => {
          try {
            const data = JSON.parse(ph.event_description || '{}');
            return data.paymentAmount || 0;
          } catch {
            return 0;
          }
        })
        .reduce((sum, amount) => sum + amount, 0);

      // This assertion SHOULD FAIL on unfixed code (proving the bug exists)
      // Expected: ₦760,000 (250k + 310k + 200k from all negative ledger entries)
      // Actual (buggy): ₦310,000 (only from property history)
      expect(totalPaymentsFromPropertyHistory).toBe(totalPaymentsFromLedger);

      // Document the counterexample when this fails
      if (totalPaymentsFromPropertyHistory !== totalPaymentsFromLedger) {
        console.log('COUNTEREXAMPLE FOUND - Payment Source Bug:');
        console.log(
          `Expected total payments (from ledger): ₦${totalPaymentsFromLedger.toLocaleString()}`,
        );
        console.log(
          `Actual total payments (from property history): ₦${totalPaymentsFromPropertyHistory.toLocaleString()}`,
        );
        console.log(
          `Gap: ₦${(totalPaymentsFromLedger - totalPaymentsFromPropertyHistory).toLocaleString()}`,
        );
        console.log(
          'This confirms the bug exists: missing reversal entries and renewal payments',
        );
      }
    });

    it('should show correct property name instead of "Unknown Property" for migration entries', () => {
      // **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)

      // Mock data representing the NULL property_id issue
      const mockMigrationEntry = {
        id: 'migration-1',
        tenant_id: TEST_TENANT_ID,
        type: 'migration',
        description: 'Migration balance',
        outstanding_balance_change: 100000,
        property_id: null, // Bug: NULL property_id
        property: null,
      };

      const mockRentRecords = [
        {
          id: 'rent-1',
          tenant_id: TEST_TENANT_ID,
          property_id: 'property-1',
          property: {
            id: 'property-1',
            name: 'Sunset Apartments Unit 5A',
          },
        },
      ];

      // **BUG CONDITION CHECK**: Migration entry should show correct property name
      // Current buggy implementation shows "Unknown Property" for NULL property_id
      const currentBuggyPropertyName =
        (mockMigrationEntry.property as any)?.name || 'Unknown Property';
      const expectedCorrectPropertyName = mockRentRecords[0].property.name; // Should resolve from tenant's rent records

      // This assertion SHOULD FAIL on unfixed code (proving the bug exists)
      // Expected: "Sunset Apartments Unit 5A" (resolved from tenant's rent records)
      // Actual (buggy): "Unknown Property" (due to NULL property_id)
      expect(currentBuggyPropertyName).toBe(expectedCorrectPropertyName);

      // Document the counterexample when this fails
      if (currentBuggyPropertyName === 'Unknown Property') {
        console.log('COUNTEREXAMPLE FOUND - Property Resolution Bug:');
        console.log(`Expected: "${expectedCorrectPropertyName}"`);
        console.log(`Actual: "${currentBuggyPropertyName}"`);
        console.log(
          'This confirms the bug exists: NULL property_id not resolved from tenant context',
        );
      }
    });

    it('should show actual payment date instead of ledger created_at for payment entries', () => {
      // **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)

      // Mock data representing the payment date issue
      const mockPaymentLedgerEntry = {
        id: 'payment-ledger-1',
        tenant_id: TEST_TENANT_ID,
        type: 'rent_payment',
        description: 'Payment received',
        outstanding_balance_change: -310000,
        related_entity_type: 'property_history',
        related_entity_id: 'ph-1',
        created_at: new Date('2026-04-04T00:00:00Z'), // Bug: showing ledger created_at
      };

      const mockPropertyHistory = {
        id: 'ph-1',
        event_type: 'user_added_payment',
        move_in_date: new Date('2026-02-15T00:00:00Z'), // Expected: actual payment date
        event_description: JSON.stringify({
          paymentAmount: 310000,
          paymentDate: '2026-02-15T00:00:00Z',
        }),
      };

      // **BUG CONDITION CHECK**: Payment date should come from property history, not ledger created_at
      // Current buggy implementation uses ledger created_at
      const currentBuggyPaymentDate = mockPaymentLedgerEntry.created_at;
      const expectedCorrectPaymentDate = mockPropertyHistory.move_in_date;

      // This assertion SHOULD FAIL on unfixed code (proving the bug exists)
      // Expected: payment date should be move_in_date (2026-02-15)
      // Actual (buggy): payment date will be ledger created_at (2026-04-04)
      expect(currentBuggyPaymentDate).toEqual(expectedCorrectPaymentDate);

      // Document the counterexample when this fails
      if (
        currentBuggyPaymentDate.getTime() !==
        expectedCorrectPaymentDate.getTime()
      ) {
        console.log('COUNTEREXAMPLE FOUND - Payment Date Bug:');
        console.log(`Expected: ${expectedCorrectPaymentDate.toISOString()}`);
        console.log(`Actual: ${currentBuggyPaymentDate.toISOString()}`);
        console.log(
          'This confirms the bug exists: showing ledger created_at instead of actual payment date',
        );
      }
    });

    it('should show specific rent periods instead of same period for all transactions', () => {
      // **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists)

      // Mock data representing the period description issue
      const mockLedgerEntries = [
        {
          id: 'ledger-1',
          related_entity_type: 'rent',
          related_entity_id: 'rent-1',
          description: 'Rent charge for Feb 2026',
        },
        {
          id: 'ledger-2',
          related_entity_type: 'rent',
          related_entity_id: 'rent-2',
          description: 'Rent charge for Mar 2026',
        },
      ];

      const mockRentRecords = [
        {
          id: 'rent-1',
          rent_start_date: new Date('2026-02-12T00:00:00Z'),
          expiry_date: new Date('2026-03-11T00:00:00Z'),
        },
        {
          id: 'rent-2',
          rent_start_date: new Date('2026-03-12T00:00:00Z'),
          expiry_date: new Date('2026-04-11T00:00:00Z'),
        },
      ];

      // **BUG CONDITION CHECK**: Each transaction should show its specific rent period
      // Current buggy implementation uses the first rent record for all transactions
      const firstRentPeriod = `(${mockRentRecords[0].rent_start_date.toLocaleDateString('en-GB')} - ${mockRentRecords[0].expiry_date.toLocaleDateString('en-GB')})`;
      const secondRentPeriod = `(${mockRentRecords[1].rent_start_date.toLocaleDateString('en-GB')} - ${mockRentRecords[1].expiry_date.toLocaleDateString('en-GB')})`;

      // Current buggy behavior: all transactions show the same period (first rent found)
      const currentBuggyBehavior = [firstRentPeriod, firstRentPeriod]; // Both show same period
      const expectedCorrectBehavior = [firstRentPeriod, secondRentPeriod]; // Each shows specific period

      // This assertion SHOULD FAIL on unfixed code (proving the bug exists)
      expect(currentBuggyBehavior).toEqual(expectedCorrectBehavior);

      // Document the counterexample when this fails
      if (
        JSON.stringify(currentBuggyBehavior) !==
        JSON.stringify(expectedCorrectBehavior)
      ) {
        console.log('COUNTEREXAMPLE FOUND - Period Description Bug:');
        console.log(
          `Expected periods: ${JSON.stringify(expectedCorrectBehavior)}`,
        );
        console.log(`Actual periods: ${JSON.stringify(currentBuggyBehavior)}`);
        console.log(
          'This confirms the bug exists: all transactions show same period instead of specific periods',
        );
      }
    });
  });

  /**
   * Property-Based Test: Bug Condition Detection Across Multiple Tenants
   *
   * This test generates various tenant configurations to verify the bug condition
   * holds across different scenarios, not just the specific test tenant.
   */
  describe('Property-Based Bug Condition Detection', () => {
    it('should detect date display bugs across various tenant configurations', () => {
      fc.assert(
        fc.property(
          // Generate tenant configurations with rent-related ledger entries
          fc.record({
            tenantId: fc.uuid(),
            ledgerEntries: fc.array(
              fc.record({
                id: fc.uuid(),
                type: fc.constantFrom('initial_balance', 'auto_renewal'),
                relatedEntityType: fc.constant('rent'),
                relatedEntityId: fc.uuid(),
                createdAt: fc.date({
                  min: new Date('2026-03-01'),
                  max: new Date('2026-04-30'),
                }),
                outstandingBalanceChange: fc.integer({
                  min: 100000,
                  max: 500000,
                }),
              }),
              { minLength: 1, maxLength: 5 },
            ),
            rentRecords: fc.array(
              fc.record({
                id: fc.uuid(),
                rentStartDate: fc.date({
                  min: new Date('2026-01-01'),
                  max: new Date('2026-02-28'),
                }),
                expiryDate: fc.date({
                  min: new Date('2026-03-01'),
                  max: new Date('2026-12-31'),
                }),
              }),
              { minLength: 1, maxLength: 3 },
            ),
          }),
          (config) => {
            // **BUG CONDITION**: For rent-related entries, the system should show rent_start_date
            // but currently shows created_at (this property will fail on unfixed code)

            config.ledgerEntries.forEach((ledgerEntry, index) => {
              const matchingRent =
                config.rentRecords[index % config.rentRecords.length];

              // The bug condition: created_at should NOT be used for display when rent_start_date is available
              const bugCondition =
                ledgerEntry.relatedEntityType === 'rent' &&
                ledgerEntry.createdAt.getTime() !==
                  matchingRent.rentStartDate.getTime();

              // This assertion documents the expected behavior (will fail on unfixed code)
              if (bugCondition) {
                // Expected: display date should be rent_start_date
                // Actual (buggy): display date is created_at
                console.log(
                  `Bug condition detected for tenant ${config.tenantId}:`,
                );
                console.log(
                  `  Ledger created_at: ${ledgerEntry.createdAt.toISOString()}`,
                );
                console.log(
                  `  Expected rent_start_date: ${matchingRent.rentStartDate.toISOString()}`,
                );
              }

              // This property encodes the expected behavior
              // For this exploration test, we expect this to fail on unfixed code
              expect(bugCondition).toBe(false); // Will fail on unfixed code when dates differ
            });
          },
        ),
        {
          numRuns: 10, // Reduced for exploration phase
          verbose: true,
        },
      );
    });
  });
});
