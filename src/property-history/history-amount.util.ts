import { PropertyHistory } from './entities/property-history.entity';

/**
 * Money on payment-shaped history rows.
 *
 * `property_histories` has no amount column, so the figure a payment row moved
 * lives in one of two places:
 *
 *  1. The linked `payments` row (`related_entity_type === 'payment'`). Exact and
 *     immutable — always preferred.
 *  2. A labelled amount inside `event_description`, written by whichever service
 *     logged the row ("Amount: ₦X", "payment of ₦X", "Installment 1 paid — ₦X").
 *
 * Rows written before the writers included an amount have neither; those simply
 * render without one rather than showing a guess.
 *
 * NOTE ON PARSING: the label must hug the ₦. A bare "first ₦ in the string"
 * match is wrong — `payment_completed_partial` descriptions read
 * "<tenant> paid for <property>. Outstanding: ₦X", and grabbing that number
 * would display the *remaining balance* as the amount paid.
 */

/** History event types that represent money moving and must show an amount. */
export const PAYMENT_HISTORY_EVENT_TYPES: ReadonlySet<string> = new Set([
  'payment_initiated',
  'payment_cancelled',
  'payment_completed_full',
  'payment_completed_partial',
  'payment_plan_installment_paid',
  'renewal_payment_initiated',
  'renewal_payment_received',
  'renewal_payment_made',
  'renewal_payment_cancelled',
  'outstanding_balance_payment',
  'ad_hoc_invoice_paid',
]);

export const formatNaira = (amount: number): string =>
  `₦${Number(amount).toLocaleString()}`;

/**
 * Pull an amount out of a history description, but only where a recognised
 * label sits immediately before the ₦. Deliberately does NOT match
 * "Outstanding: ₦X" / "Remaining: ₦X" — those are balances, not amounts.
 */
export const extractStatedAmount = (
  description?: string | null,
): number | null => {
  if (!description) return null;

  const match = description.match(
    /(?:amount(?:\s+paid)?\s*:?|payment\s+of|paid\s*[—–-]?)\s*₦\s*([\d,]+(?:\.\d{1,2})?)/i,
  );
  if (!match) return null;

  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * Resolve the amount for a history row. `paymentAmountsById` maps `payments.id`
 * → amount for the rows whose `related_entity_id` points at a payment; pass it
 * where those rows are already loaded, omit it to fall back to the description.
 */
export const resolveHistoryAmount = (
  history: Pick<
    PropertyHistory,
    | 'event_type'
    | 'event_description'
    | 'related_entity_id'
    | 'related_entity_type'
  >,
  paymentAmountsById?: Map<string, number>,
): number | null => {
  if (
    paymentAmountsById &&
    history.related_entity_type === 'payment' &&
    history.related_entity_id
  ) {
    const linked = paymentAmountsById.get(history.related_entity_id);
    if (linked != null && linked > 0) return linked;
  }

  return extractStatedAmount(history.event_description);
};

/**
 * Append the amount to a timeline title, matching the shape payment-plan
 * installment rows already use ("Installment 1 paid — ₦5,000,000"). No-ops when
 * the title already carries a figure so those rows don't double up.
 */
export const withAmountInTitle = (
  title: string,
  amount: number | null,
): string => {
  if (amount == null || title.includes('₦')) return title;
  return `${title} — ${formatNaira(amount)}`;
};
