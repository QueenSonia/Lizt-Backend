/**
 * Date helpers for the payment-plan timeline. Two distinct notions of "date"
 * meet here and must not be conflated:
 *
 *  - DATE columns (installment.due_date, renewal_invoice.start/end_date) carry
 *    a calendar date with no timezone; TypeORM hands them back as a Date at
 *    UTC midnight. Read their calendar date from the UTC components.
 *  - "today" and reminder send instants are true moments — compare them in the
 *    business timezone (Africa/Lagos, UTC+1, no DST) so a plan due *today* is
 *    never mislabelled overdue at UTC midnight.
 */

const BUSINESS_TZ = 'Africa/Lagos';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Calendar date (YYYY-MM-DD) of a DB DATE value, read from UTC components. */
export function dbDateKey(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Calendar date (YYYY-MM-DD) of a true instant, in the business timezone. */
export function businessDateKey(
  d: Date | string | null | undefined,
  tz: string = BUSINESS_TZ,
): string {
  const date = d == null ? new Date() : typeof d === 'string' ? new Date(d) : d;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** Today's calendar date (YYYY-MM-DD) in the business timezone. */
export function todayBusinessKey(tz: string = BUSINESS_TZ): string {
  return businessDateKey(new Date(), tz);
}

/** Whole-day difference `aKey - bKey` for two YYYY-MM-DD keys. */
export function daysBetweenKeys(aKey: string, bKey: string): number {
  const a = Date.parse(`${aKey}T00:00:00Z`);
  const b = Date.parse(`${bKey}T00:00:00Z`);
  return Math.round((a - b) / 86_400_000);
}

/** ISO timestamp of a value, tolerating Date | string | nullish (→ epoch). */
export function toIso(d: Date | string | null | undefined): string {
  if (!d) return new Date(0).toISOString();
  return (typeof d === 'string' ? new Date(d) : d).toISOString();
}

/** Epoch millis of a value, tolerating Date | string | nullish (→ 0). */
export function toMillis(d: Date | string | null | undefined): number {
  if (!d) return 0;
  return (typeof d === 'string' ? new Date(d) : d).getTime();
}
