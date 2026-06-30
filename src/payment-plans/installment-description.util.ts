import { PaymentPlanScope } from './entities/payment-plan.entity';

/**
 * Compose the "...under {clause}." phrase embedded in the installment
 * reminder / overdue WhatsApp templates — the single folded `plan_description`
 * variable ({{6}} on the reminder, {{5}} on the overdue notice), varied by
 * plan scope:
 *   - TENANCY → "your tenancy payment plan for {property}, {location},
 *     covering the tenancy period {period}"
 *   - OB      → "your outstanding balance payment plan for {property}, {location}"
 *   - CHARGE  → "your {chargeName} payment plan for {property}, {location}"
 *
 * Pure on purpose: each caller resolves the property / location / period from
 * whatever it has in hand (the cron from the renewal invoice or active rent,
 * the tap-pay short-circuit from the rent it's already holding) and passes the
 * pieces in, so the WORDING lives in exactly one place and can't drift between
 * the two send sites. `location` is dropped when blank; the tenancy period is
 * dropped when null.
 */
export function buildInstallmentPlanClause(opts: {
  scope: PaymentPlanScope;
  chargeName: string | null;
  propertyName: string;
  location?: string | null;
  tenancyPeriod?: string | null; // "dd/MM/yyyy – dd/MM/yyyy" or null
}): string {
  const loc = opts.location?.trim();
  const place = loc ? `${opts.propertyName}, ${loc}` : opts.propertyName;

  if (opts.scope === PaymentPlanScope.TENANCY) {
    return opts.tenancyPeriod
      ? `your tenancy payment plan for ${place}, covering the tenancy period ${opts.tenancyPeriod}`
      : `your tenancy payment plan for ${place}`;
  }

  if (opts.scope === PaymentPlanScope.OB) {
    return `your outstanding balance payment plan for ${place}`;
  }

  // CHARGE scope — use the landlord's charge label (e.g. "Service Charge").
  const label = opts.chargeName?.trim();
  return label
    ? `your ${label} payment plan for ${place}`
    : `your payment plan for ${place}`;
}
