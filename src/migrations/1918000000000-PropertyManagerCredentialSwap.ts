import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Property-manager transition — STEP 2 of 3: CREDENTIAL SWAP (reversible).
 *
 * Moves the software owner's login (email + bcrypt password) from the Panda
 * Homes LANDLORD account onto the ADMIN account, and parks the landlord account
 * on the secondary email with a NULL password (login-disabled). After this Tunji
 * signs in once with the same email + password and lands on the PM dashboard;
 * the landlord account persists as a managed, login-disabled data record.
 *
 * accounts.email is the login anchor (unique IDX_accounts_email_unique) and
 * accounts.password is canonical (users.password is stale — see memory
 * `password_column_canonical`). We swap on accounts; users.password is synced
 * (nulled / moved) but users.email is intentionally left untouched (display-only;
 * avoids a second unique-index shuffle). A temp email frees the unique index
 * mid-swap.
 *
 * Parameterised via env (prod defaults); on dev set both to the dev accounts:
 *   PM_OWNER_LOGIN_EMAIL  (default 'tunjioginni@gmail.com')  — owner's login
 *   PM_PARKED_EMAIL       (default 'tunji@getpanda.co')      — parked secondary
 *
 * Idempotent: a no-op once the admin already holds OWNER_EMAIL.
 * Reversible: the admin's ORIGINAL (email, password) is stashed in
 * `_pm_credential_swap_backup`; down() restores both accounts exactly and drops
 * the stash. Both bcrypt hashes are confirmed present ($2b$) on prod.
 */
export class PropertyManagerCredentialSwap1918000000000
  implements MigrationInterface
{
  name = 'PropertyManagerCredentialSwap1918000000000';

  private ownerEmail(): string {
    return (process.env.PM_OWNER_LOGIN_EMAIL ?? 'tunjioginni@gmail.com')
      .trim()
      .toLowerCase();
  }
  private parkedEmail(): string {
    return (process.env.PM_PARKED_EMAIL ?? 'tunji@getpanda.co')
      .trim()
      .toLowerCase();
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const OWNER_EMAIL = this.ownerEmail();
    const PARKED_EMAIL = this.parkedEmail();
    const TEMP_EMAIL = '__pm_swap_temp__@propertykraft.local';

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "_pm_credential_swap_backup" (
        "admin_account_id" uuid PRIMARY KEY,
        "original_email" varchar,
        "original_password" varchar,
        "swapped_at" timestamptz NOT NULL DEFAULT now()
      )
    `);

    const adminRows = await queryRunner.query(
      `SELECT id, email, password, "userId" FROM accounts
         WHERE 'admin' = ANY(roles) AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
    );
    if (!adminRows?.length) {
      throw new Error(
        'PropertyManagerCredentialSwap: no admin account found. Run 1917 first / create the admin.',
      );
    }
    const admin = adminRows[0];

    // Idempotent: already swapped.
    if (admin.email && admin.email.trim().toLowerCase() === OWNER_EMAIL) {
      return;
    }

    const ownerRows = await queryRunner.query(
      `SELECT id, email, password, "userId" FROM accounts
         WHERE LOWER(email) = $1 AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
      [OWNER_EMAIL],
    );
    if (!ownerRows?.length) {
      throw new Error(
        `PropertyManagerCredentialSwap: no account holds the owner login email (${OWNER_EMAIL}). ` +
          'Set PM_OWNER_LOGIN_EMAIL to the correct account email for this environment.',
      );
    }
    const owner = ownerRows[0];
    if (owner.id === admin.id) {
      throw new Error(
        'PropertyManagerCredentialSwap: owner email resolves to the admin account itself — unexpected topology.',
      );
    }
    const ownerPassword: string | null = owner.password;

    // Stash the admin's ORIGINAL credentials for a precise rollback (first run wins).
    await queryRunner.query(
      `INSERT INTO "_pm_credential_swap_backup" (admin_account_id, original_email, original_password)
       VALUES ($1, $2, $3)
       ON CONFLICT (admin_account_id) DO NOTHING`,
      [admin.id, admin.email, admin.password],
    );

    // 3-step email shuffle (accounts.email is unique):
    //  1) admin -> temp           (frees whatever the admin held, e.g. PARKED)
    //  2) owner -> PARKED + NULL  (frees OWNER_EMAIL, disables landlord login)
    //  3) admin -> OWNER + pwd    (admin now logs in as the owner did)
    await queryRunner.query(`UPDATE accounts SET email = $1 WHERE id = $2`, [
      TEMP_EMAIL,
      admin.id,
    ]);
    await queryRunner.query(
      `UPDATE accounts SET email = $1, password = NULL WHERE id = $2`,
      [PARKED_EMAIL, owner.id],
    );
    await queryRunner.query(
      `UPDATE accounts SET email = $1, password = $2 WHERE id = $3`,
      [OWNER_EMAIL, ownerPassword, admin.id],
    );

    // Sync the (stale) users.password column to match: disable the landlord
    // user, carry the hash to the admin user. users.email left as-is.
    await queryRunner.query(`UPDATE users SET password = NULL WHERE id = $1`, [
      owner.userId,
    ]);
    await queryRunner.query(`UPDATE users SET password = $1 WHERE id = $2`, [
      ownerPassword,
      admin.userId,
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const OWNER_EMAIL = this.ownerEmail();
    const PARKED_EMAIL = this.parkedEmail();
    const TEMP_EMAIL = '__pm_swap_temp__@propertykraft.local';

    const adminRows = await queryRunner.query(
      `SELECT id, email, password, "userId" FROM accounts
         WHERE 'admin' = ANY(roles) AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
    );
    if (!adminRows?.length) return;
    const admin = adminRows[0];

    const backupRows = await queryRunner.query(
      `SELECT original_email, original_password FROM "_pm_credential_swap_backup" WHERE admin_account_id = $1`,
      [admin.id],
    );
    if (!backupRows?.length) {
      // Nothing to reverse (swap never ran for this admin).
      return;
    }
    const backup = backupRows[0];
    // The owner's password currently lives on the admin (moved there in up()).
    const ownerPassword: string | null = admin.password;

    const parkedRows = await queryRunner.query(
      `SELECT id, "userId" FROM accounts
         WHERE LOWER(email) = $1 AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
      [PARKED_EMAIL],
    );
    if (!parkedRows?.length) {
      throw new Error(
        `PropertyManagerCredentialSwap.down: no account holds the parked email (${PARKED_EMAIL}); cannot reverse safely.`,
      );
    }
    const parked = parkedRows[0];

    // Reverse the 3-step shuffle.
    await queryRunner.query(`UPDATE accounts SET email = $1 WHERE id = $2`, [
      TEMP_EMAIL,
      admin.id,
    ]);
    await queryRunner.query(
      `UPDATE accounts SET email = $1, password = $2 WHERE id = $3`,
      [OWNER_EMAIL, ownerPassword, parked.id],
    );
    await queryRunner.query(
      `UPDATE accounts SET email = $1, password = $2 WHERE id = $3`,
      [backup.original_email, backup.original_password, admin.id],
    );

    // Restore users.password.
    await queryRunner.query(`UPDATE users SET password = $1 WHERE id = $2`, [
      ownerPassword,
      parked.userId,
    ]);
    await queryRunner.query(`UPDATE users SET password = $1 WHERE id = $2`, [
      backup.original_password,
      admin.userId,
    ]);

    await queryRunner.query(
      `DELETE FROM "_pm_credential_swap_backup" WHERE admin_account_id = $1`,
      [admin.id],
    );
  }
}
