import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Property-manager transition — STEP 5 (follow-up to 1917 + 1923): RESTORE
 * BRANDING onto the consolidated identity.
 *
 * Ordering hazard this fixes: 1917-center copies the owner's branding onto the
 * ADMIN user and NULLs every other landlord user's branding — including the
 * owner's real user. 1923 then repoints the admin account onto that real user
 * (whose branding is now NULL) and soft-deletes the admin's placeholder user
 * (which holds the only surviving copy). Net: the consolidated user ends with
 * NULL branding and tenant-facing documents lose the business name AND the
 * letterhead/logo. (Verified on a prod-copy Neon branch, 2026-07-08.)
 *
 * This restores it deterministically: the retired placeholder user id is read
 * from 1923's backup table (`_pm_identity_consolidation_backup`), and its
 * branding / logo_urls / offer_letter_template are moved onto the consolidated
 * real user, with `branding.businessName` set to the admin brand
 * (PM_ADMIN_PROFILE_NAME, default 'Property Kraft') per the "always Property
 * Kraft" policy. Existing values on the real user are preferred via COALESCE so
 * a re-run (or a post-transition Admin-Settings edit) is never clobbered.
 *
 * Idempotent + self-contained. No-op if 1923 never ran (no backup row) or the
 * retired user carried no branding.
 */
export class RestoreConsolidatedBrandingAfterPMTransition1927000000000
  implements MigrationInterface
{
  name = 'RestoreConsolidatedBrandingAfterPMTransition1927000000000';

  private adminBrandName(): string {
    return (process.env.PM_ADMIN_PROFILE_NAME ?? 'Property Kraft').trim();
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const BRAND = this.adminBrandName();

    const adminRows = await queryRunner.query(
      `SELECT id, "userId" FROM accounts
         WHERE 'admin' = ANY(roles) AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
    );
    if (!adminRows?.length) return;
    const admin = adminRows[0];
    const realUserId: string = admin.userId;

    // The retired (placeholder) admin user that still holds the pre-null
    // branding, recorded by 1923.
    const backupRows = await queryRunner.query(
      `SELECT placeholder_user_id
         FROM "_pm_identity_consolidation_backup"
        WHERE admin_account_id = $1`,
      [admin.id],
    );
    if (!backupRows?.length) return; // 1923 never ran for this admin.
    const retiredUserId: string = backupRows[0].placeholder_user_id;

    if (retiredUserId === realUserId) return; // nothing to move.

    // Move branding/logo/template from the retired user onto the consolidated
    // real user, forcing businessName to the admin brand. COALESCE keeps any
    // value already present on the real user (re-run / post-edit safe).
    await queryRunner.query(
      `UPDATE users realU
          SET branding = jsonb_set(
                COALESCE(realU.branding, retired.branding, '{}'::jsonb),
                '{businessName}', to_jsonb($1::text), true
              ),
              logo_urls = COALESCE(realU.logo_urls, retired.logo_urls),
              offer_letter_template =
                COALESCE(realU.offer_letter_template, retired.offer_letter_template)
         FROM users retired
        WHERE realU.id = $2 AND retired.id = $3`,
      [BRAND, realUserId, retiredUserId],
    );
  }

  public async down(): Promise<void> {
    // No-op: branding restoration is not meaningfully reversible (the pre-run
    // NULL was itself the bug). The retired user's copy remains intact on the
    // soft-deleted row if a manual reversal is ever needed.
  }
}
