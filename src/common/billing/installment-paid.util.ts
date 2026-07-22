import { InstallmentStatus } from '../../payment-plans/entities/payment-plan-installment.entity';

/** The minimal installment shape the paid-math helpers need. */
export interface InstallmentPaidLike {
  status: InstallmentStatus | string;
  amount: number | string;
  amount_paid?: number | string | null;
}

/**
 * What a single installment has actually collected so far.
 *
 * - PAID    → `amount_paid`, falling back to the face amount for legacy rows
 *             written before `amount_paid` existed.
 * - PARTIAL → `amount_paid` (never the face amount — that's the whole point).
 * - PENDING → 0. `amount_paid` is null/0 here, but be explicit so a stray
 *             value can never inflate the sum.
 *
 * This is THE paid-to-date rule. Every TS site that used to filter
 * `status === PAID` sums through here; the raw-SQL mirror lives in
 * `TenantBalancesService.sumActiveWalletBackedPlanClaims` — keep both in sync.
 */
export function installmentPaidToDate(inst: InstallmentPaidLike): number {
  const status = String(inst.status).toLowerCase();
  if (status === InstallmentStatus.PAID) {
    return Number(inst.amount_paid ?? inst.amount);
  }
  if (status === InstallmentStatus.PARTIAL) {
    return Number(inst.amount_paid ?? 0);
  }
  return 0;
}

/** Paid-to-date across a whole schedule. */
export function sumInstallmentsPaid(
  installments: InstallmentPaidLike[],
): number {
  return installments.reduce((sum, i) => sum + installmentPaidToDate(i), 0);
}

/** What an installment is still owed. 0 for PAID rows (within rounding). */
export function installmentRemaining(inst: InstallmentPaidLike): number {
  return Math.max(0, Number(inst.amount) - installmentPaidToDate(inst));
}
