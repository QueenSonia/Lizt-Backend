/**
 * Placeholder-email detection.
 *
 * Several write paths synthesise an email when none was collected:
 *   - legacy FM forms (LandlordFacilityManagers, LandlordFacility):
 *     `fm_1747000000000@temp.facility`
 *   - KYC tenant attachment (tenant-attachment.service, tenant_kyc upsert):
 *     `tenant_2348012345678@placeholder.lizt.app`
 *   - legacy KYC path (tenant-management): `2348012345678@placeholder.com`
 *
 * Those rows can't be used to log in by email and shouldn't be picked over a
 * real email when merging accounts.
 *
 * This helper is the single source of truth for "is this email synthetic?"
 * Used by team/landlord/tenant write paths and the userId-dedupe migration.
 */
export function isPlaceholderEmail(
  email: string | null | undefined,
): boolean {
  if (!email) return false;
  return /@(temp\.facility|placeholder\.lizt\.app|placeholder\.com)$/i.test(
    email.trim(),
  );
}
