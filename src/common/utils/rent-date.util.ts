/**
 * Calculates a rent record's `expiry_date` from the tenancy start date and
 * payment frequency.
 *
 * Rule: expiry is the day BEFORE the next cycle begins.
 *   Start 2025-09-01 annually → next cycle 2026-09-01 → expiry 2026-08-31
 *   Start 2024-01-31 monthly  → next cycle 2024-02-29 → expiry 2024-02-28
 *
 * Accepts any casing/variant used across the codebase: 'Annually', 'annually',
 * 'yearly', 'Bi-Annually', 'biannually', etc. Unknown values fall back to
 * monthly to match prior behaviour.
 *
 * Note: passing 'custom' here is a programming error — custom periods do not
 * have an implicit duration, so the caller must supply the end date directly.
 */
export function calculateRentExpiryDate(
  startDate: Date,
  frequency: string,
): Date {
  const normalized = normalizeFrequency(frequency);
  if (normalized === 'custom') {
    throw new Error(
      'calculateRentExpiryDate cannot derive an expiry date for custom frequency; pass the end date explicitly',
    );
  }

  const nextDate = new Date(startDate);
  const dueDay = startDate.getDate();

  switch (normalized) {
    case 'monthly':
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    case 'quarterly':
      nextDate.setMonth(nextDate.getMonth() + 3);
      break;
    case 'bi-annually':
      nextDate.setMonth(nextDate.getMonth() + 6);
      break;
    case 'annually':
      nextDate.setFullYear(nextDate.getFullYear() + 1);
      break;
  }

  // Restore the original day-of-month. If the target month is shorter
  // (e.g. Feb has no 31st), setDate(dueDay) overflows into the next month;
  // setDate(0) then backtracks to the last day of the intended month.
  const targetMonth = nextDate.getMonth();
  nextDate.setDate(dueDay);
  if (nextDate.getMonth() !== targetMonth) {
    nextDate.setDate(0);
  }

  nextDate.setDate(nextDate.getDate() - 1);

  return nextDate;
}

export type StandardFrequency =
  | 'monthly'
  | 'quarterly'
  | 'bi-annually'
  | 'annually';

/**
 * Per-frequency days-before-expiry offsets at which the rent reminder cron
 * fires. Lives here (rather than in rent-reminder.service) so any service
 * that needs to reason about the reminder schedule — e.g. the rent-change
 * impact preview — can import it without pulling a cron-module dep.
 */
export const RENT_REMINDER_SCHEDULE: Record<string, number[]> = {
  monthly: [14, 7, 2, 1, 0],
  quarterly: [30, 14, 7, 2, 1, 0],
  'bi-annually': [90, 60, 30, 14, 7, 2, 1, 0],
  biannually: [90, 60, 30, 14, 7, 2, 1, 0],
  annually: [180, 90, 60, 30, 14, 7, 2, 1, 0],
};

// First reminder tick at or below this day-count switches from the standard
// template to the renewal-link template (and creates/reuses the renewal
// invoice). Annual tenants get a longer window so they have time to arrange
// a year's rent.
export const RENEWAL_TEMPLATE_THRESHOLD: Record<string, number> = {
  monthly: 7,
  quarterly: 7,
  'bi-annually': 7,
  biannually: 7,
  annually: 30,
};
export const DEFAULT_RENEWAL_TEMPLATE_THRESHOLD = 7;

export type NormalizedFrequency = StandardFrequency | 'custom';

export function normalizeFrequency(frequency: string): NormalizedFrequency {
  const f = (frequency || '').toLowerCase().trim();
  if (f === 'custom') return 'custom';
  if (f === 'quarterly') return 'quarterly';
  if (
    f === 'bi-annually' ||
    f === 'biannually' ||
    f === 'semi-annually' ||
    f === 'semiannually'
  ) {
    return 'bi-annually';
  }
  if (f === 'annually' || f === 'yearly') return 'annually';
  return 'monthly';
}

/**
 * Number of whole months in one period of the given standard frequency.
 * Throws for 'custom' — callers with a custom period should use
 * `effectiveFrequency` (for logic that needs a standard bucket) or
 * derive the duration from the rent's start/end dates directly.
 */
export function frequencyToMonths(frequency: string): number {
  const normalized = normalizeFrequency(frequency);
  switch (normalized) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'bi-annually':
      return 6;
    case 'annually':
      return 12;
    case 'custom':
      throw new Error(
        'frequencyToMonths cannot be called with custom frequency — use effectiveFrequency or derive from dates',
      );
  }
}

/**
 * Rough duration in months between two dates, using whole-day math then
 * dividing by an average month length. Only used for bucketing custom
 * periods into the nearest standard frequency — not for ledger math.
 */
function approximateMonthsBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  const days = Math.max(0, (end.getTime() - start.getTime()) / msPerDay);
  // 30.4375 ≈ average days per month (365.25 / 12). Close enough for bucketing.
  return days / 30.4375;
}

/**
 * Maps any rent (standard or custom frequency) to a standard frequency for
 * logic that depends on one — reminder schedule lookups, auto-advance math, etc.
 *
 * For standard frequencies, returns the frequency as-is.
 * For 'custom', buckets by period length rounding UP (safer — reminders
 * fire earlier rather than later):
 *   ≤ 1 month  → monthly
 *   ≤ 3 months → quarterly
 *   ≤ 6 months → bi-annually
 *   > 6 months → annually
 *
 * If the rent is 'custom' but start/end dates are not both available, falls
 * back to 'monthly' (the shortest bucket — errs on the side of more reminders).
 */
export function effectiveFrequency(rent: {
  payment_frequency?: string | null;
  rent_start_date?: Date | string | null;
  expiry_date?: Date | string | null;
}): StandardFrequency {
  const normalized = normalizeFrequency(rent.payment_frequency || '');
  if (normalized !== 'custom') return normalized;

  if (!rent.rent_start_date || !rent.expiry_date) return 'monthly';

  const start =
    rent.rent_start_date instanceof Date
      ? rent.rent_start_date
      : new Date(rent.rent_start_date);
  const end =
    rent.expiry_date instanceof Date
      ? rent.expiry_date
      : new Date(rent.expiry_date);

  const months = approximateMonthsBetween(start, end);
  if (months <= 1) return 'monthly';
  if (months <= 3) return 'quarterly';
  if (months <= 6) return 'bi-annually';
  return 'annually';
}

/**
 * Advance a date by exactly one payment period, month-overflow safe.
 * E.g. Jan 31 + 1 month → Feb 28/29, not Mar 2/3.
 *
 * For 'custom' frequency, the caller must pass `customDurationMonths` derived
 * from the rent's own period length (typically via `effectiveFrequency`
 * upstream, or an explicit bucket); otherwise this will throw.
 */
export function advancePeriod(
  date: Date,
  frequency: string,
  customDurationMonths?: number,
): Date {
  const normalized = normalizeFrequency(frequency);

  let monthsToAdd: number;
  if (normalized === 'custom') {
    if (customDurationMonths == null || customDurationMonths <= 0) {
      throw new Error(
        'advancePeriod requires customDurationMonths > 0 when frequency is custom',
      );
    }
    monthsToAdd = customDurationMonths;
  } else {
    monthsToAdd = frequencyToMonths(normalized);
  }

  const result = new Date(date);
  const expectedMonth = (result.getMonth() + monthsToAdd) % 12;
  result.setMonth(result.getMonth() + monthsToAdd);
  if (result.getMonth() !== expectedMonth) {
    result.setDate(0);
  }
  return result;
}

/**
 * Given a start date and a rent (for its frequency, and for period-duration
 * in the custom case), return the inclusive last day of that period — i.e.
 * (start + one period) − 1 day. Matches the `expiry_date is the day before
 * the next cycle` convention used throughout the codebase.
 */
export function nextPeriodEndInclusive(
  startDate: Date,
  rent: {
    payment_frequency?: string | null;
    rent_start_date?: Date | string | null;
    expiry_date?: Date | string | null;
  },
): Date {
  const normalized = normalizeFrequency(rent.payment_frequency || '');
  if (normalized !== 'custom') {
    return calculateRentExpiryDate(startDate, normalized);
  }
  const end = advanceRentPeriod(startDate, rent);
  end.setDate(end.getDate() - 1);
  return end;
}

/**
 * Advance a date by one period, where the period length is derived from the
 * rent itself — for custom-frequency rents the duration comes from
 * (expiry_date - rent_start_date); for standard frequencies it's fixed.
 *
 * Use this in any auto-renewal / next-period-computation path that must
 * handle both kinds of rent uniformly.
 */
export function advanceRentPeriod(
  date: Date,
  rent: {
    payment_frequency?: string | null;
    rent_start_date?: Date | string | null;
    expiry_date?: Date | string | null;
  },
): Date {
  const normalized = normalizeFrequency(rent.payment_frequency || '');
  if (normalized !== 'custom') {
    return advancePeriod(date, normalized);
  }
  if (!rent.rent_start_date || !rent.expiry_date) {
    // No way to derive duration — fall back to monthly to match prior behaviour.
    return advancePeriod(date, 'monthly');
  }
  const start =
    rent.rent_start_date instanceof Date
      ? rent.rent_start_date
      : new Date(rent.rent_start_date);
  const end =
    rent.expiry_date instanceof Date
      ? rent.expiry_date
      : new Date(rent.expiry_date);
  const months = Math.max(1, Math.round(approximateMonthsBetween(start, end)));
  return advancePeriod(date, 'custom', months);
}
