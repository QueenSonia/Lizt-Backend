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
 */
export function calculateRentExpiryDate(
  startDate: Date,
  frequency: string,
): Date {
  const nextDate = new Date(startDate);
  const dueDay = startDate.getDate();

  switch (normalizeFrequency(frequency)) {
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

type NormalizedFrequency = 'monthly' | 'quarterly' | 'bi-annually' | 'annually';

function normalizeFrequency(frequency: string): NormalizedFrequency {
  const f = (frequency || '').toLowerCase().trim();
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
