import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Property-manager transition — STEP 1 of 3: CENTERING (data migration).
 *
 * Re-points the whole hierarchy onto the single Property Kraft admin. Run AFTER
 * the schema migrations 1914 (accounts.landlord_type) + 1915 (kyc_links.scope_type
 * / admin_creator_id), and BEFORE 1918 (credential swap) + 1919 (team consolidation).
 *
 * Deterministic + idempotent. Anchored on:
 *   - the ADMIN account, resolved by the `admin` role (prod: the existing
 *     "Tunji's Admin Account"; dev: create one — see runbook — before running);
 *   - the SOFTWARE-OWNER landlord, resolved by the login email it still holds at
 *     this point (Panda Homes / `tunjioginni@gmail.com`). The credential swap
 *     (1918) moves that email onto the admin AFTER this migration, so anchoring
 *     on it here is correct.
 *
 * Parameterised via env (prod defaults) so the same file works on dev — set
 * PM_OWNER_LOGIN_EMAIL to the dev landlord's email when rehearsing on dev:
 *   PM_OWNER_LOGIN_EMAIL  (default 'tunjioginni@gmail.com')
 *   PM_ADMIN_PROFILE_NAME (default 'Property Kraft')
 *
 * NOT auto-run on boot (no migrationsRun) — executed deliberately via
 * `npm run migration:run` in a maintenance window, dev first.
 *
 * down() is BEST-EFFORT: creator_id is cleared and the admin KYC link
 * deactivated, but the collapsed landlord branding + per-landlord
 * kyc_feedback.landlord_id values are intentionally one-way (the plan deletes
 * landlord branding). For a true rollback, restore the pre-run DB snapshot.
 */
export class PropertyManagerTransitionCenter1917000000000
  implements MigrationInterface
{
  name = 'PropertyManagerTransitionCenter1917000000000';

  private ownerEmail(): string {
    return (process.env.PM_OWNER_LOGIN_EMAIL ?? 'tunjioginni@gmail.com')
      .trim()
      .toLowerCase();
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    const OWNER_EMAIL = this.ownerEmail();
    const ADMIN_PROFILE = (
      process.env.PM_ADMIN_PROFILE_NAME ?? 'Property Kraft'
    ).trim();
    // The secondary email. On prod the existing admin currently holds this;
    // when we SEED a dev admin we give it this email too — i.e. it is only the
    // admin's PRE-SWAP placeholder. The 1918 credential swap then flips things:
    // admin -> OWNER_EMAIL (tunjioginni@gmail.com) and the landlord lands
    // ("parked", login-disabled) on this email. So nothing here is the final
    // admin email; 1918 is what produces admin=owner-email / landlord=parked.
    const PARKED_EMAIL = (
      process.env.PM_PARKED_EMAIL ?? 'tunji@getpanda.co'
    )
      .trim()
      .toLowerCase();
    // Canonical placeholder (users.phone_number is UNIQUE + CHECK ^234[0-9]{10}$).
    // Only used when seeding a brand-new admin on a fresh env (e.g. dev).
    const ADMIN_PHONE = (
      process.env.PM_ADMIN_PLACEHOLDER_PHONE ?? '2340000000000'
    ).trim();

    // 1. Resolve the single Property Kraft admin — FIND or CREATE. Prod has an
    //    existing admin (found by role). A fresh env (dev) has none, so we seed
    //    one: a "Property Kraft" user + an admin account on the parked email,
    //    cloning the owner's password so it is usable immediately (1918 then
    //    reaffirms + swaps in the login email). The create branch never runs on
    //    prod (admin already exists). enum type is `accounts_role_enum`.
    let adminRows = await queryRunner.query(
      `SELECT id, "userId" FROM accounts
         WHERE 'admin' = ANY(roles) AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
    );
    if (!adminRows?.length) {
      const ownerRows = await queryRunner.query(
        `SELECT id, password FROM accounts
           WHERE LOWER(email) = $1 AND 'landlord' = ANY(roles) AND deleted_at IS NULL
           ORDER BY created_at ASC LIMIT 1`,
        [OWNER_EMAIL],
      );
      if (!ownerRows?.length) {
        throw new Error(
          `PropertyManagerTransitionCenter: no admin exists and no landlord holds ${OWNER_EMAIL} ` +
            'to seed one from. Set PM_OWNER_LOGIN_EMAIL correctly for this environment.',
        );
      }
      const ownerPassword: string | null = ownerRows[0].password;
      const newUser = await queryRunner.query(
        `INSERT INTO users (first_name, last_name, email, phone_number, is_verified)
         VALUES ('Property', 'Kraft', $1, $2, true) RETURNING id`,
        [PARKED_EMAIL, ADMIN_PHONE],
      );
      adminRows = await queryRunner.query(
        `INSERT INTO accounts (id, email, password, is_verified, profile_name, roles, "userId")
         VALUES (uuid_generate_v4(), $1, $2, true, $3, '{admin}'::accounts_role_enum[], $4)
         RETURNING id, "userId"`,
        [PARKED_EMAIL, ownerPassword, ADMIN_PROFILE, newUser[0].id],
      );
    }
    const adminId: string = adminRows[0].id;
    const adminUserId: string = adminRows[0].userId;

    // 2. Rename the admin's display name → "Property Kraft".
    await queryRunner.query(`UPDATE accounts SET profile_name = $1 WHERE id = $2`, [
      ADMIN_PROFILE,
      adminId,
    ]);

    // 3. Backfill creator_id = admin for every LANDLORD / FACILITY_MANAGER
    //    account (never the admin itself, never tenants — tenant.creator_id
    //    carries a different "who onboarded this tenant" meaning). This is the
    //    one column the whole scope model reads (resolveManagedLandlordIds /
    //    resolveScopeLandlordIds).
    await queryRunner.query(
      `UPDATE accounts
          SET creator_id = $1
        WHERE id <> $1
          AND deleted_at IS NULL
          AND ('landlord' = ANY(roles) OR 'facility_manager' = ANY(roles))
          AND creator_id IS DISTINCT FROM $1`,
      [adminId],
    );

    // 4. Branding: copy the software owner's (Panda Homes) user branding + logo
    //    onto the admin's user, then null every OTHER landlord user's branding
    //    (all tenant-facing docs now resolve via the admin — Workstream F). The
    //    owner is anchored by the login email it still holds (pre-swap).
    await queryRunner.query(
      `UPDATE users adminU
          SET branding = ownerU.branding,
              logo_urls = ownerU.logo_urls
         FROM users ownerU
         JOIN accounts ownerA ON ownerA."userId" = ownerU.id
        WHERE adminU.id = $1
          AND LOWER(ownerA.email) = $2`,
      [adminUserId, OWNER_EMAIL],
    );
    await queryRunner.query(
      `UPDATE users
          SET branding = NULL
        WHERE id <> $1
          AND id IN (
            SELECT DISTINCT "userId" FROM accounts
             WHERE 'landlord' = ANY(roles) AND deleted_at IS NULL
          )`,
      [adminUserId],
    );

    // 5. KYC feedback now belongs to the property manager (single admin).
    await queryRunner.query(
      `UPDATE kyc_feedback SET landlord_id = $1 WHERE landlord_id IS DISTINCT FROM $1`,
      [adminId],
    );

    // 6. Ensure exactly one active admin-scope KYC link exists for the admin
    //    (surfaces vacancies across all managed landlords). Existing per-landlord
    //    links are left active (tokens in the wild — append-only).
    await queryRunner.query(
      `INSERT INTO kyc_links (id, token, landlord_id, scope_type, admin_creator_id, is_active)
       SELECT gen_random_uuid(), gen_random_uuid(), $1,
              'admin'::kyc_links_scope_type_enum, $1, true
        WHERE NOT EXISTS (
          SELECT 1 FROM kyc_links
           WHERE scope_type = 'admin'::kyc_links_scope_type_enum
             AND admin_creator_id = $1
             AND is_active = true
        )`,
      [adminId],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const adminRows = await queryRunner.query(
      `SELECT id FROM accounts
         WHERE 'admin' = ANY(roles) AND deleted_at IS NULL
         ORDER BY created_at ASC LIMIT 1`,
    );
    if (!adminRows?.length) return;
    const adminId: string = adminRows[0].id;

    // Deactivate the admin-scope KYC link this migration created.
    await queryRunner.query(
      `UPDATE kyc_links SET is_active = false
        WHERE scope_type = 'admin'::kyc_links_scope_type_enum
          AND admin_creator_id = $1`,
      [adminId],
    );

    // Clear the managed-by-admin link on landlord/FM accounts. Prior values
    // can't be distinguished, so this resets to NULL (the pre-transition state
    // for these roles).
    await queryRunner.query(
      `UPDATE accounts SET creator_id = NULL
        WHERE creator_id = $1
          AND ('landlord' = ANY(roles) OR 'facility_manager' = ANY(roles))`,
      [adminId],
    );

    // NOTE: profile_name, collapsed branding and kyc_feedback.landlord_id are
    // NOT restored (one-way per the plan). Restore a DB snapshot for those.
  }
}
