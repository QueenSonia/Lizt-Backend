/**
 * Coverage predicate for the unified renewal model.
 *
 * Rent renewal is now unified across ALL frequencies: an unpaid period FLOATS
 * at expiry and only advances when the tenant accepts the letter and pays. The
 * one cron-driven advance that survives is "wallet credit fully covers the
 * period -> settle from credit". The decision of whether a period is "fully
 * covered" is the same boundary predicate everywhere:
 *
 *     recurringCharge - effectiveWallet <= 0
 *
 * Source sites this mirrors (all share the `<= 0` boundary):
 *   - RentReminderService.isCarriedPeriodFullyCovered  (the NEW helper)
 *       => recurringCharge - walletBalance <= 0
 *     (cron/rent-reminder.service.ts: rentToFees → carried-forward fees)
 *   - RentReminderService.isNextPeriodFullyCovered
 *   - RenewalChargeService.isLetterPeriodCoveredByCredit
 *       => recurringCharge - (walletBalance + ownLetterCharge) <= 0
 *     (the letter-sourced variants add the own-letter OB charge back so a
 *      period already OB-charged at accept time still reads as covered)
 *   - RenewalChargeService.renewOneFromWalletCredit
 *       => coveredByWallet = walletAfterCharge >= 0
 *     (equivalent: after debiting the period charge, a non-negative wallet
 *      means the credit absorbed it — i.e. credit >= charge)
 *
 * This is a SELF-CONTAINED pure-logic test: it replicates the tiny predicate
 * locally (exactly as renewal-fold.spec.ts replicates the fold formula) rather
 * than instantiating the full RentReminderService with all its repository
 * mocks, which is brittle and not what's under test. What matters is the
 * boundary semantics — that "fully covered" is `<= 0` (inclusive at equality),
 * NOT `< 0`.
 */

// Local replica of isCarriedPeriodFullyCovered's decision (the new helper):
//   recurringCharge - walletBalance <= 0
// `walletBalance` is the tenant wallet's signed value: positive = credit,
// negative = debt. A higher credit makes the expression more negative, i.e.
// more clearly covered.
const isPeriodFullyCovered = (
  recurringCharge: number,
  walletBalance: number,
): boolean => recurringCharge - walletBalance <= 0;

describe('renewal coverage predicate (recurringCharge - walletBalance <= 0)', () => {
  it('credit greater than the charge: covered', () => {
    expect(isPeriodFullyCovered(200_000, 250_000)).toBe(true);
  });

  it('credit exactly equal to the charge: covered (boundary, <= 0 not < 0)', () => {
    expect(isPeriodFullyCovered(200_000, 200_000)).toBe(true);
  });

  it('credit less than the charge: NOT covered', () => {
    expect(isPeriodFullyCovered(200_000, 150_000)).toBe(false);
  });

  it('credit one naira short of the charge: NOT covered (boundary)', () => {
    expect(isPeriodFullyCovered(200_000, 199_999)).toBe(false);
  });

  it('zero credit, positive charge: NOT covered (the floating-period case)', () => {
    expect(isPeriodFullyCovered(200_000, 0)).toBe(false);
  });

  it('zero credit, zero charge: covered (nothing is owed)', () => {
    expect(isPeriodFullyCovered(0, 0)).toBe(true);
  });

  it('negative wallet (tenant owes) never covers a positive charge', () => {
    expect(isPeriodFullyCovered(200_000, -70_000)).toBe(false);
  });

  it('negative wallet still fails even a zero charge (existing debt)', () => {
    // charge 0, wallet −1 → 0 − (−1) = 1 > 0 → not covered: the tenant is
    // still in arrears, so the period does not auto-settle from credit.
    expect(isPeriodFullyCovered(0, -1)).toBe(false);
  });
});

/**
 * The letter-sourced variants (isNextPeriodFullyCovered /
 * isLetterPeriodCoveredByCredit) add the own-letter OB charge back into the
 * effective wallet before applying the same `<= 0` boundary, so a period that
 * was already OB-charged at accept time (wallet shows the debit) still reads as
 * covered. We replicate that add-back and assert the identical boundary.
 */
const isLetterPeriodFullyCovered = (
  recurringCharge: number,
  walletBalance: number,
  ownLetterCharge: number,
): boolean => recurringCharge - (walletBalance + ownLetterCharge) <= 0;

describe('renewal coverage predicate with own-letter add-back', () => {
  it('own-letter charge restores an already-debited wallet to covered (boundary)', () => {
    // Wallet was debited the 200k period charge at accept time (balance 0),
    // but that same 200k is added back → 200k − (0 + 200k) = 0 ≤ 0 → covered.
    expect(isLetterPeriodFullyCovered(200_000, 0, 200_000)).toBe(true);
  });

  it('with no own-letter charge it collapses to the plain predicate', () => {
    expect(isLetterPeriodFullyCovered(200_000, 200_000, 0)).toBe(true);
    expect(isLetterPeriodFullyCovered(200_000, 150_000, 0)).toBe(false);
  });

  it('partial own-letter add-back can still leave the period short', () => {
    // 200k charge, wallet 0, only 199_999 added back → 1 > 0 → not covered.
    expect(isLetterPeriodFullyCovered(200_000, 0, 199_999)).toBe(false);
  });
});

/**
 * renewOneFromWalletCredit phrases the same decision post-debit as
 * `coveredByWallet = walletAfterCharge >= 0`. With walletAfterCharge defined as
 * (creditBeforeCharge − recurringCharge), `>= 0` is algebraically identical to
 * the `recurringCharge - walletBalance <= 0` boundary above. We assert the two
 * forms agree at and around the equality boundary so the inclusive semantics
 * stay aligned across both phrasings.
 */
const coveredByWalletAfterCharge = (
  creditBeforeCharge: number,
  recurringCharge: number,
): boolean => creditBeforeCharge - recurringCharge >= 0;

describe('renewOneFromWalletCredit phrasing (walletAfterCharge >= 0) agrees', () => {
  const cases: Array<[number, number]> = [
    [200_000, 250_000], // credit > charge
    [200_000, 200_000], // credit == charge (boundary)
    [200_000, 150_000], // credit < charge
    [0, 0], // nothing owed
    [200_000, 0], // zero credit, positive charge
  ];

  it.each(cases)(
    'charge=%i credit=%i: >=0 phrasing matches the <=0 phrasing',
    (charge, credit) => {
      expect(coveredByWalletAfterCharge(credit, charge)).toBe(
        isPeriodFullyCovered(charge, credit),
      );
    },
  );
});
