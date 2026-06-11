import { computeRenewalFold } from '../../src/common/billing/renewal-fold';

/**
 * computeRenewalFold is the single source of truth for the renewal-invoice
 * wallet fold across SIX call sites (refreshInvoiceTotals, dashboard letter
 * send/edit, updateRenewalInvoice, the reminder cron, WhatsApp landlord-approve
 * and tenant "Pay OB"). It must exclude wallet debt owned by an active
 * wallet-backed plan so the same debt is never billed twice.
 */
describe('computeRenewalFold', () => {
  it('no plans, wallet owes: folds the full debt onto the period charge', () => {
    const r = computeRenewalFold({
      periodCharge: 200_000,
      walletBalance: -70_000,
      claimedByPlans: 0,
    });
    expect(r.totalAmount).toBe(270_000);
    expect(r.outstandingBalance).toBe(70_000);
  });

  it('no plans, wallet in credit: credit reduces the total, outstanding 0', () => {
    const r = computeRenewalFold({
      periodCharge: 200_000,
      walletBalance: 30_000,
      claimedByPlans: 0,
    });
    expect(r.totalAmount).toBe(170_000);
    expect(r.outstandingBalance).toBe(0);
  });

  it('plan owns the entire OB: fold excludes it (renewal bills only the period)', () => {
    const r = computeRenewalFold({
      periodCharge: 200_000,
      walletBalance: -70_000,
      claimedByPlans: 70_000,
    });
    expect(r.totalAmount).toBe(200_000);
    expect(r.outstandingBalance).toBe(0);
  });

  it('plan owns part of the OB: fold bills only the un-planned slice', () => {
    const r = computeRenewalFold({
      periodCharge: 200_000,
      walletBalance: -70_000,
      claimedByPlans: 50_000,
    });
    expect(r.totalAmount).toBe(220_000); // 200k + (70k − 50k)
    expect(r.outstandingBalance).toBe(20_000);
  });

  it('plan claim exceeds the debt: never creates a spurious credit', () => {
    const r = computeRenewalFold({
      periodCharge: 200_000,
      walletBalance: -50_000,
      claimedByPlans: 80_000,
    });
    expect(r.totalAmount).toBe(200_000); // capped at periodCharge, not below
    expect(r.outstandingBalance).toBe(0);
  });

  it('a wallet credit is never reduced by plan claims', () => {
    const r = computeRenewalFold({
      periodCharge: 200_000,
      walletBalance: 30_000, // credit
      claimedByPlans: 100_000,
    });
    expect(r.totalAmount).toBe(170_000); // credit untouched
    expect(r.outstandingBalance).toBe(0);
  });

  it('ownLetterCharge is added back before folding (no 2× period)', () => {
    // This period’s ₦200k was posted to the wallet as a letter_accepted_charge,
    // so wallet = −200k but it is already in the breakdown — must not re-fold.
    const r = computeRenewalFold({
      periodCharge: 200_000,
      walletBalance: -200_000,
      claimedByPlans: 0,
      ownLetterCharge: 200_000,
    });
    expect(r.totalAmount).toBe(200_000); // not 400k
  });

  it('OB-only invoice (periodCharge 0): total == un-planned outstanding', () => {
    const r = computeRenewalFold({
      periodCharge: 0,
      walletBalance: -70_000,
      claimedByPlans: 50_000,
    });
    expect(r.totalAmount).toBe(20_000);
    expect(r.outstandingBalance).toBe(20_000);
  });

  it('OB-only invoice fully covered by a plan: total 0', () => {
    const r = computeRenewalFold({
      periodCharge: 0,
      walletBalance: -70_000,
      claimedByPlans: 70_000,
    });
    expect(r.totalAmount).toBe(0);
    expect(r.outstandingBalance).toBe(0);
  });

  it('original double-collection trace is fixed (plan owns the OB)', () => {
    // A=50k + B=50k debit, +30k credit → walletOB −70k; rent 200k; OB plan 70k.
    const r = computeRenewalFold({
      periodCharge: 200_000,
      walletBalance: -70_000,
      claimedByPlans: 70_000,
    });
    // Renewal bills rent only; the ₦70k OB is collected by the plan → ₦270k owed
    // total once, not ₦340k.
    expect(r.totalAmount).toBe(200_000);
  });
});
