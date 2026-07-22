import {
  PaymentPlan,
  PaymentPlanStatus,
} from '../entities/payment-plan.entity';
import { InstallmentStatus } from '../entities/payment-plan-installment.entity';
import { installmentRemaining } from '../../common/billing/installment-paid.util';
import { dbDateKey, toIso } from './date-util';

export interface SyntheticOverdue {
  planId: string;
  installmentId: string;
  sequence: number;
  amount: number;
  dueDate: string; // ISO date
  /** ISO timestamp used for sorting — the installment's TRUE due date. */
  occurredAt: string;
}

/**
 * Synthesize "installment became overdue" events for a plan. There is no
 * stored overdue event and no OVERDUE installment status — an installment is
 * overdue iff it is still PENDING and its due date is strictly before today
 * (business-timezone, date-only, matching `plan-classification`).
 *
 * Only ACTIVE plans qualify: an unpaid installment on a cancelled/completed
 * plan no longer demands payment, so it is not surfaced as overdue.
 *
 * `todayKey` is the caller's business-today (YYYY-MM-DD) so every row in one
 * response shares a single "now".
 */
export function synthesizeOverdue(
  plan: PaymentPlan,
  todayKey: string,
): SyntheticOverdue[] {
  if (plan.status !== PaymentPlanStatus.ACTIVE) return [];

  const out: SyntheticOverdue[] = [];
  for (const inst of plan.installments ?? []) {
    // PARTIAL is still unpaid — it stays overdue for its remaining balance.
    if (inst.status === InstallmentStatus.PAID) continue;
    const dueKey = dbDateKey(inst.due_date);
    if (!dueKey || dueKey >= todayKey) continue; // ISO keys compare lexicographically
    const remaining = installmentRemaining(inst);
    if (remaining <= 0) continue;
    out.push({
      planId: plan.id,
      installmentId: inst.id,
      sequence: inst.sequence,
      amount: remaining,
      dueDate: dueKey,
      occurredAt: toIso(inst.due_date),
    });
  }
  return out;
}
