import {
  PaymentPlan,
  PaymentPlanScope,
  PaymentPlanSourceType,
} from '../../payment-plans/entities/payment-plan.entity';
import { InstallmentStatus } from '../../payment-plans/entities/payment-plan-installment.entity';

/**
 * Is this a charge-scope plan that targets a *current-period invoice fee*
 * (rent / service / a named "other" fee)?
 *
 * Such a plan carves its fee out of the renewal invoice at creation, so the fee
 * never hits the tenant wallet ledger — see the long note on
 * `PaymentPlansService.isInvoiceFeeChargePlan` (which delegates here so there is
 * one source of truth). The synthetic "Outstanding Balance" charge and ad-hoc /
 * OB plans settle real wallet-backed debt and return `false`.
 */
export function isInvoiceFeeChargePlan(
  plan: Pick<
    PaymentPlan,
    'scope' | 'source_type' | 'ad_hoc_invoice_id' | 'charge_external_id'
  >,
): boolean {
  if (plan.scope !== PaymentPlanScope.CHARGE) return false;
  // Type B (wallet-backed) charge plans settle real wallet debt — never gate.
  if (
    plan.source_type === PaymentPlanSourceType.OUTSTANDING_BALANCE ||
    plan.source_type === PaymentPlanSourceType.AD_HOC_INVOICE
  ) {
    return false;
  }
  if (plan.ad_hoc_invoice_id) return false;
  if (plan.charge_external_id === 'outstanding_balance') return false;
  return true;
}

/**
 * Sum the PENDING installments past their due date for active *invoice-fee
 * charge* plans (the carved ones), grouped by property.
 *
 * These are the only plan installments NOT already represented on the wallet
 * ledger: a carved fee was pulled out of the invoice and never debited the
 * wallet, so an overdue installment of one is invisible in the landlord's
 * balance breakdown. Ad-hoc / OB plan debt is real wallet OB and already shows
 * there, so including it here would double-count — hence the
 * `isInvoiceFeeChargePlan` filter.
 *
 * Display-only: nothing is written to the ledger. `plans` must be loaded with
 * the `installments` and `property` relations.
 */
export function sumOverdueInvoiceFeeInstallments(
  plans: PaymentPlan[],
  landlordId: string,
  asOf: Date = new Date(),
): { total: number; byProperty: Record<string, number> } {
  const cutoff = new Date(asOf);
  cutoff.setHours(0, 0, 0, 0);

  const byProperty: Record<string, number> = {};
  let total = 0;

  for (const plan of plans) {
    if (plan.property?.owner_id !== landlordId) continue;
    if (!isInvoiceFeeChargePlan(plan)) continue;

    let overdue = 0;
    for (const inst of plan.installments ?? []) {
      if (inst.status !== InstallmentStatus.PENDING) continue;
      const due = new Date(inst.due_date);
      due.setHours(0, 0, 0, 0);
      if (due < cutoff) overdue += Number(inst.amount);
    }
    if (overdue <= 0) continue;

    total += overdue;
    byProperty[plan.property_id] =
      (byProperty[plan.property_id] ?? 0) + overdue;
  }

  return { total, byProperty };
}
