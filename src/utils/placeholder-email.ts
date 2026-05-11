/**
 * Placeholder-email detection.
 *
 * Two of the legacy frontend FM-creation forms (LandlordFacilityManagers,
 * LandlordFacility) don't collect a real email — they synthesise one from
 * `Date.now()`, like `fm_1747000000000@temp.facility`. Those rows can't be
 * used to log in by email and shouldn't be picked over a real email when
 * merging accounts.
 *
 * This helper is the single source of truth for "is this email synthetic?"
 * Used by team/landlord write paths and the userId-dedupe migration.
 */
export function isPlaceholderEmail(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return /@temp\.facility$/i.test(email.trim());
}
