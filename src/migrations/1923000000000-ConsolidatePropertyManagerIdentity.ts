import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Property-manager transition — STEP 4 (follow-up to 1917/1918): IDENTITY
 * CONSOLIDATION (reversible).
 *
 * After 1917 (center) + 1918 (credential swap) the software owner is split
 * across TWO users rows:
 *   - the ADMIN account ("Property Kraft") points at a SEEDED placeholder user
 *     (name "Property Kraft", placeholder phone 2340000000000, no offer-letter
 *     template);
 *   - the PARKED owner-landlord account ("Panda Homes") points at his REAL user
 *     (real name + real WhatsApp number + offer_letter_template).
 *
 * Because a landlord-directed notification resolves its destination through the
 * managing admin's USER (see NotificationRecipientsService / resolveBrandingUser),
 * every notification about the owner's own portfolio is currently addressed to
 * the placeholder phone and reaches nobody, and his real number is never tried.
 *
 * This migration collapses the two accounts onto ONE users row — the real user —
 * so the admin and landlord accounts share a single identity (one phone, one
 * email, one person) while keeping their distinct `profile_name`s
 * ("Property Kraft" vs "Panda Homes") and roles. accounts.userId has no unique
 * index, and one users row owning many accounts is the intended multi-role shape
 * (already present for other users in prod-like data), so this is a supported
 * topology, not a hack.
 *
 * Branding continuity: the real user already carries the richer branding
 * (businessName + offer_letter_template), so pointing the admin account at it
 * *improves* the resolved brand (gains the template) with no loss. The
 * placeholder's weaker branding copy is discarded with the soft-delete. Renaming
 * the tenant-facing brand to "Property Kraft" (branding.businessName / logo) is a
 * separate Admin Settings action, intentionally NOT done here.
 *
 * Parameterised via env (prod defaults); on dev these already resolve correctly:
 *   PM_PARKED_EMAIL  (default 'tunji@getpanda.co')  — the parked landlord's login
 *
 * The admin is resolved by the `admin` role (as in 1917/1918). The REAL user is
 * the parked landlord's userId. Idempotent: a no-op once the admin already points
 * at the real user. Reversible: the admin's ORIGINAL (placeholder) userId and the
 * exact set of moved chat_log ids are stashed in
 * `_pm_identity_consolidation_backup`; down() restores both accounts, un-deletes
 * the placeholder user, and drops the stash.
 *
 * NOT auto-run on boot — executed deliberately via `npm run migration:run`,
 * dev first.
 */
export class ConsolidatePropertyManagerIdentity1923000000000
  implements MigrationInterface
{
  name = 'ConsolidatePropertyManagerIdentity1923000000000';

  private parkedEmail(): string {
    return (process.env.PM_PARKED_EMAIL ?? 'tunji@getpanda.co')
      .trim()
      .toLowerCase();
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const PARKED_EMAIL = this.parkedEmail();

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "_pm_identity_consolidation_backup" (
        "admin_account_id" uuid PRIMARY KEY,
        "placeholder_user_id" uuid NOT NULL,
        "real_user_id" uuid NOT NULL,
        "moved_chat_log_ids" uuid[] NOT NULL DEFAULT '{}',
        "consolidated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    const adminRows = await queryRunner.query(
      `SELECT id, "userId" FROM accounts
         WHERE 'admin' = ANY(roles) AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
    );
    if (!adminRows?.length) {
      throw new Error(
        'ConsolidatePropertyManagerIdentity: no admin account found. Run 1917/1918 first.',
      );
    }
    const admin = adminRows[0];
    const placeholderUserId: string = admin.userId;

    const parkedRows = await queryRunner.query(
      `SELECT id, "userId", roles FROM accounts
         WHERE LOWER(email) = $1 AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
      [PARKED_EMAIL],
    );
    if (!parkedRows?.length) {
      throw new Error(
        `ConsolidatePropertyManagerIdentity: no account holds the parked email (${PARKED_EMAIL}). ` +
          'Set PM_PARKED_EMAIL to the parked owner-landlord email for this environment.',
      );
    }
    const parked = parkedRows[0];
    const realUserId: string = parked.userId;

    // Idempotent: admin already consolidated onto the real user.
    if (placeholderUserId === realUserId) {
      return;
    }

    if (parked.id === admin.id) {
      throw new Error(
        'ConsolidatePropertyManagerIdentity: parked email resolves to the admin account itself — unexpected topology.',
      );
    }
    if (!(parked.roles ?? []).includes('landlord')) {
      throw new Error(
        `ConsolidatePropertyManagerIdentity: parked account (${PARKED_EMAIL}) is not a landlord — refusing to consolidate onto an unexpected user.`,
      );
    }

    // Capture the chat_logs we are about to move, for an exact reversal.
    const chatRows = await queryRunner.query(
      `SELECT id FROM chat_logs WHERE user_id = $1`,
      [placeholderUserId],
    );
    const movedChatLogIds: string[] = chatRows.map((r: { id: string }) => r.id);

    // Stash for rollback (first run wins).
    await queryRunner.query(
      `INSERT INTO "_pm_identity_consolidation_backup"
         (admin_account_id, placeholder_user_id, real_user_id, moved_chat_log_ids)
       VALUES ($1, $2, $3, $4::uuid[])
       ON CONFLICT (admin_account_id) DO NOTHING`,
      [admin.id, placeholderUserId, realUserId, movedChatLogIds],
    );

    // 1) Move the placeholder user's bot conversation history onto the real user.
    await queryRunner.query(
      `UPDATE chat_logs SET user_id = $1 WHERE user_id = $2`,
      [realUserId, placeholderUserId],
    );

    // 2) Repoint the admin account onto the real user (the consolidation).
    await queryRunner.query(
      `UPDATE accounts SET "userId" = $1 WHERE id = $2`,
      [realUserId, admin.id],
    );

    // 3) Retire the now-orphaned placeholder user (soft-delete; reversible).
    await queryRunner.query(
      `UPDATE users SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`,
      [placeholderUserId],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const adminRows = await queryRunner.query(
      `SELECT id, "userId" FROM accounts
         WHERE 'admin' = ANY(roles) AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
    );
    if (!adminRows?.length) return;
    const admin = adminRows[0];

    const backupRows = await queryRunner.query(
      `SELECT placeholder_user_id, real_user_id, moved_chat_log_ids
         FROM "_pm_identity_consolidation_backup" WHERE admin_account_id = $1`,
      [admin.id],
    );
    if (!backupRows?.length) {
      // Nothing to reverse (consolidation never ran for this admin).
      return;
    }
    const backup = backupRows[0];
    const placeholderUserId: string = backup.placeholder_user_id;
    const movedChatLogIds: string[] = backup.moved_chat_log_ids ?? [];

    // 1) Un-retire the placeholder user.
    await queryRunner.query(
      `UPDATE users SET deleted_at = NULL WHERE id = $1`,
      [placeholderUserId],
    );

    // 2) Repoint the admin account back onto the placeholder user.
    await queryRunner.query(
      `UPDATE accounts SET "userId" = $1 WHERE id = $2`,
      [placeholderUserId, admin.id],
    );

    // 3) Move exactly the chat_logs we moved in up() back to the placeholder.
    if (movedChatLogIds.length) {
      await queryRunner.query(
        `UPDATE chat_logs SET user_id = $1 WHERE id = ANY($2::uuid[])`,
        [placeholderUserId, movedChatLogIds],
      );
    }

    await queryRunner.query(
      `DELETE FROM "_pm_identity_consolidation_backup" WHERE admin_account_id = $1`,
      [admin.id],
    );
  }
}
