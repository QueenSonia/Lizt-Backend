/**
 * The ONE place the renewal-invoice "wallet fold" is computed.
 *
 * A tenant's wallet OB folds into their unpaid renewal invoice's total. But
 * wallet OB already owned by an active wallet-backed payment plan (Outstanding
 * Balance / ad-hoc) is collected by that plan's installments — folding it into a
 * renewal invoice too would bill the same debt twice (renewal + plan). So every
 * site that derives a renewal invoice's `total_amount` / `outstanding_balance`
 * from the wallet MUST exclude the plan-owned slice.
 *
 * There are many such sites (refreshInvoiceTotals, the dashboard letter
 * send/edit, updateRenewalInvoice, the reminder cron, the WhatsApp landlord-
 * approve and tenant "Pay OB" flows). They kept hand-rolling the formula and
 * drifting, re-introducing double-collection. Route them all through here.
 *
 * Pure + synchronous: callers fetch `walletBalance`, `claimedByPlans`
 * (TenantBalancesService.sumActiveWalletBackedPlanClaims) and the optional
 * `ownLetterCharge`, then call this.
 */
export interface RenewalFoldInput {
  /** Σ of the fees billed for this invoice's period (sumAll of fee_breakdown). */
  periodCharge: number;
  /** Signed wallet balance: negative = tenant owes, positive = credit. */
  walletBalance: number;
  /** Σ remaining of active wallet-backed plans (>= 0). Excluded from the fold. */
  claimedByPlans: number;
  /**
   * A letter_accepted_charge posted for THIS invoice's own period (already in
   * the breakdown) — added back so it isn't double-counted as wallet debt.
   * Default 0 (the common monthly case).
   */
  ownLetterCharge?: number;
}

export interface RenewalFoldResult {
  totalAmount: number;
  outstandingBalance: number;
}

export function computeRenewalFold(input: RenewalFoldInput): RenewalFoldResult {
  const ownLetterCharge = input.ownLetterCharge ?? 0;
  const claimed = Math.max(0, input.claimedByPlans);

  const effectiveWallet = input.walletBalance + ownLetterCharge;
  // Debt the wallet would fold onto the invoice (after the own-letter add-back).
  const foldedDebt = effectiveWallet < 0 ? -effectiveWallet : 0;
  // Remove the plan-owned slice — capped at the debt, so plan claims can never
  // manufacture a spurious credit and a genuine wallet credit is untouched.
  const planAdjustedDebt = Math.max(0, foldedDebt - claimed);
  const foldWallet = effectiveWallet < 0 ? -planAdjustedDebt : effectiveWallet;

  const rawOutstanding = input.walletBalance < 0 ? -input.walletBalance : 0;

  return {
    totalAmount: Math.max(0, input.periodCharge - foldWallet),
    // Un-planned outstanding shown on the invoice.
    outstandingBalance: Math.max(0, rawOutstanding - claimed),
  };
}
