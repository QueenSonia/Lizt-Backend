/**
 * Billing v2 — normalized fee shape used across the money pipeline.
 *
 * Money units: all amounts in this file are **naira** (whole numbers or
 * decimals, never kobo). The DB is inconsistent — offer_letters and
 * renewal_invoices use decimal(n,2), but rents stores rent/service/security
 * as int. Adapters below coerce everything through Number(); callers must
 * be sure never to pass kobo without dividing by 100 first.
 *
 * Why no runtime polymorphism: the three entities use different column
 * names (`rental_price` vs `rent_amount`), different nullability, and the
 * renewal invoice already has a jsonb `fee_breakdown` that IS Fee[]
 * serialized. Three explicit adapters beat in-band discriminators.
 */

export type FeeKind =
  | 'rent'
  | 'service'
  | 'caution'
  | 'legal'
  | 'agency'
  | 'other';

export interface Fee {
  kind: FeeKind;
  /** Landlord-facing label. Persisted so renames survive renewals. */
  label: string;
  /** Amount in naira. Non-negative. */
  amount: number;
  /** True if this fee recurs every payment period after move-in. */
  recurring: boolean;
  /**
   * Stable id for otherFees so renaming "Diesel" → "Generator" doesn't
   * create a ghost fee on the next renewal period. Required for kind:'other',
   * absent for the fixed kinds.
   */
  externalId?: string;
}

export interface OtherFee {
  externalId: string;
  name: string;
  amount: number;
  recurring: boolean;
}

// ── Adapter types (structural subset — avoids importing entities) ──────────

interface OfferLetterLike {
  rent_amount: number | string | null | undefined;
  rent_frequency?: string | null;
  service_charge?: number | string | null;
  service_charge_recurring?: boolean | null;
  caution_deposit?: number | string | null;
  caution_deposit_recurring?: boolean | null;
  legal_fee?: number | string | null;
  legal_fee_recurring?: boolean | null;
  agency_fee?: number | string | null;
  agency_fee_recurring?: boolean | null;
  other_fees?: OtherFee[] | null;
}

interface RentLike {
  rental_price: number | string | null | undefined;
  service_charge?: number | string | null;
  service_charge_recurring?: boolean | null;
  security_deposit?: number | string | null;
  security_deposit_recurring?: boolean | null;
  legal_fee?: number | string | null;
  legal_fee_recurring?: boolean | null;
  agency_fee?: number | string | null;
  agency_fee_recurring?: boolean | null;
  other_fees?: OtherFee[] | null;
  payment_frequency?: string | null;
}

interface RenewalInvoiceLike {
  rent_amount: number | string | null | undefined;
  service_charge?: number | string | null;
  legal_fee?: number | string | null;
  agency_fee?: number | string | null;
  caution_deposit?: number | string | null;
  other_charges?: number | string | null;
  other_fees?: OtherFee[] | null;
  fee_breakdown?: Fee[] | null;
}

const num = (v: unknown): number => {
  if (v == null) return 0;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
};

const bool = (v: unknown, fallback: boolean): boolean =>
  typeof v === 'boolean' ? v : fallback;

const pushIfPositive = (
  fees: Fee[],
  kind: FeeKind,
  label: string,
  amount: number,
  recurring: boolean,
): void => {
  if (amount > 0) fees.push({ kind, label, amount, recurring });
};

// ── Label helpers ──────────────────────────────────────────────────────────

export const rentLabelFor = (frequency?: string | null): string => {
  const f = (frequency || '').trim();
  return f ? `Rent (${f})` : 'Rent';
};

// ── Adapters ───────────────────────────────────────────────────────────────

export function offerLetterToFees(offer: OfferLetterLike): Fee[] {
  const fees: Fee[] = [];
  pushIfPositive(
    fees,
    'rent',
    rentLabelFor(offer.rent_frequency),
    num(offer.rent_amount),
    true, // rent is always recurring by definition
  );
  pushIfPositive(
    fees,
    'service',
    'Service Charge',
    num(offer.service_charge),
    bool(offer.service_charge_recurring, true),
  );
  pushIfPositive(
    fees,
    'caution',
    'Caution Deposit',
    num(offer.caution_deposit),
    bool(offer.caution_deposit_recurring, false),
  );
  pushIfPositive(
    fees,
    'legal',
    'Legal Fee',
    num(offer.legal_fee),
    bool(offer.legal_fee_recurring, false),
  );
  pushIfPositive(
    fees,
    'agency',
    'Agency Fee',
    num(offer.agency_fee),
    bool(offer.agency_fee_recurring, false),
  );
  for (const of of offer.other_fees ?? []) {
    if (num(of.amount) > 0) {
      fees.push({
        kind: 'other',
        label: of.name,
        amount: num(of.amount),
        recurring: !!of.recurring,
        externalId: of.externalId,
      });
    }
  }
  return fees;
}

export function rentToFees(rent: RentLike): Fee[] {
  const fees: Fee[] = [];
  pushIfPositive(
    fees,
    'rent',
    rentLabelFor(rent.payment_frequency),
    num(rent.rental_price),
    true,
  );
  pushIfPositive(
    fees,
    'service',
    'Service Charge',
    num(rent.service_charge),
    bool(rent.service_charge_recurring, true),
  );
  pushIfPositive(
    fees,
    'caution',
    'Security Deposit',
    num(rent.security_deposit),
    bool(rent.security_deposit_recurring, false),
  );
  pushIfPositive(
    fees,
    'legal',
    'Legal Fee',
    num(rent.legal_fee),
    bool(rent.legal_fee_recurring, false),
  );
  pushIfPositive(
    fees,
    'agency',
    'Agency Fee',
    num(rent.agency_fee),
    bool(rent.agency_fee_recurring, false),
  );
  for (const of of rent.other_fees ?? []) {
    if (num(of.amount) > 0) {
      fees.push({
        kind: 'other',
        label: of.name,
        amount: num(of.amount),
        recurring: !!of.recurring,
        externalId: of.externalId,
      });
    }
  }
  return fees;
}

export function renewalInvoiceToFees(inv: RenewalInvoiceLike): Fee[] {
  // Prefer the snapshotted breakdown if present — it captures the exact
  // per-fee state at invoice creation and is what the UI should render.
  if (Array.isArray(inv.fee_breakdown) && inv.fee_breakdown.length > 0) {
    return inv.fee_breakdown
      .filter((f) => num(f.amount) > 0)
      .map((f) => ({ ...f, amount: num(f.amount) }));
  }

  const fees: Fee[] = [];
  pushIfPositive(fees, 'rent', 'Rent', num(inv.rent_amount), true);
  pushIfPositive(fees, 'service', 'Service Charge', num(inv.service_charge), true);
  pushIfPositive(fees, 'caution', 'Caution Deposit', num(inv.caution_deposit), false);
  pushIfPositive(fees, 'legal', 'Legal Fee', num(inv.legal_fee), false);
  pushIfPositive(fees, 'agency', 'Agency Fee', num(inv.agency_fee), false);
  // Legacy `other_charges` scalar — render as a single line.
  pushIfPositive(fees, 'other', 'Other Charges', num(inv.other_charges), false);
  for (const of of inv.other_fees ?? []) {
    if (num(of.amount) > 0) {
      fees.push({
        kind: 'other',
        label: of.name,
        amount: num(of.amount),
        recurring: !!of.recurring,
        externalId: of.externalId,
      });
    }
  }
  return fees;
}

// ── Aggregators ────────────────────────────────────────────────────────────

export const sumRecurring = (fees: Fee[]): number =>
  fees.reduce((acc, f) => (f.recurring ? acc + num(f.amount) : acc), 0);

export const sumOneTime = (fees: Fee[]): number =>
  fees.reduce((acc, f) => (f.recurring ? acc : acc + num(f.amount)), 0);

export const sumAll = (fees: Fee[]): number =>
  fees.reduce((acc, f) => acc + num(f.amount), 0);

/**
 * Roll a fee set forward into the next rent period.
 *
 * Recurring fees survive unchanged. Non-recurring fees (caution, legal,
 * agency, or one-time otherFees) are dropped — they were collected at
 * move-in and should not be re-billed every renewal period.
 */
export const nextPeriodFees = (fees: Fee[]): Fee[] =>
  fees.filter((f) => f.recurring);

/**
 * Short human-readable CSV of fee labels for ledger descriptions, e.g.
 * "Caution Deposit, Legal Fee, Agency Fee".
 */
export const feeLabelsCsv = (fees: Fee[]): string =>
  fees.map((f) => f.label).join(', ');
