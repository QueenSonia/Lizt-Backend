import {
  PaymentPlan,
  PaymentPlanScope,
  PaymentPlanSourceType,
} from '../entities/payment-plan.entity';
import {
  PaymentPlanRequest,
  PaymentPlanRequestSource,
} from '../entities/payment-plan-request.entity';
import { PlanCategory } from './dto/payment-plan-timeline.dto';

/**
 * The category key is what collapses many plans/requests into one timeline row.
 *
 *  - `ob` and `tenancy` are AGGREGATE keys — every OB / Entire-Tenancy plan
 *    across every period folds into the one row.
 *  - `adhoc:<invoiceId>` — one row per ad-hoc invoice.
 *  - `charge:<kind>` (or `charge:other:<ident>`) — one row per carved-charge
 *    IDENTITY, folding successive periods' carves of the same fee together.
 *
 * The OB guards mirror `plan-classification.isInvoiceFeeChargePlan`: legacy OB
 * plans were created scope='charge' with a synthetic `outstanding_balance`
 * external id before the dedicated `ob` scope existed, so we detect them by
 * source_type / external_id too.
 */

export function normalizeChargeIdent(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function planCategoryKey(
  plan: Pick<
    PaymentPlan,
    | 'id'
    | 'scope'
    | 'source_type'
    | 'ad_hoc_invoice_id'
    | 'charge_fee_kind'
    | 'charge_external_id'
    | 'charge_name'
  >,
): string {
  if (
    plan.scope === PaymentPlanScope.OB ||
    plan.source_type === PaymentPlanSourceType.OUTSTANDING_BALANCE ||
    plan.charge_external_id === 'outstanding_balance'
  ) {
    return 'ob';
  }
  if (plan.scope === PaymentPlanScope.TENANCY) return 'tenancy';

  // scope === 'charge' from here.
  if (plan.source_type === PaymentPlanSourceType.AD_HOC_INVOICE) {
    return `adhoc:${plan.ad_hoc_invoice_id ?? plan.id}`;
  }

  const kind = plan.charge_fee_kind ?? 'other';
  if (kind === 'other') {
    // `charge_external_id` is the stable identity for an "other" fee, but may
    // churn across renewals; fall back to the normalized label so the same
    // named fee still aggregates period-over-period.
    const ident =
      plan.charge_external_id ?? normalizeChargeIdent(plan.charge_name);
    return `charge:other:${ident}`;
  }
  return `charge:${kind}`;
}

export function requestCategoryKey(
  req: Pick<PaymentPlanRequest, 'source'>,
): string {
  return req.source === PaymentPlanRequestSource.OB ? 'ob' : 'tenancy';
}

export function categoryOfKey(key: string): PlanCategory {
  if (key === 'ob') return 'ob';
  if (key === 'tenancy') return 'entire_tenancy';
  if (key.startsWith('adhoc:')) return 'ad_hoc';
  return 'specific_charge';
}
