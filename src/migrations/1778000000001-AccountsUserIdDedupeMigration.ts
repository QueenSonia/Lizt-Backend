import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Follow-up to AccountsRolesArrayMigration1778000000000.
 *
 * The first migration deduped accounts by EMAIL — collapsing rows that shared
 * the same email but had different roles. It missed the symmetric case: rows
 * for the same userId that have DIFFERENT emails (typically a real-email
 * tenant/landlord row plus a placeholder-email FM row from the legacy
 * fake-email frontend forms — `fm_<ts>@temp.facility`).
 *
 * Concretely, against current data we expect to collapse:
 *   • dev:  1 group  (gwagwalada@gmail.com tenant + fm_xxx FM, same userId)
 *   • prod: 2 groups (poesitor1@gmail.com landlord + fm_xxx FM,
 *                     soniaakpati7@gmail.com tenant + fm_xxx FM)
 *
 * For each group we pick a canonical row by:
 *   1. Real email beats placeholder (`@temp.facility`)
 *   2. Among real-email rows, prefer LANDLORD > FACILITY_MANAGER > TENANT > others
 *   3. Else oldest by created_at
 *
 * Then merge roles[] across the group, copy the canonical's email/password,
 * re-point every FK that targets accounts.id to the canonical, and delete the
 * non-canonical rows. Same FK-rerouting pattern as the first migration.
 */
export class AccountsUserIdDedupeMigration1778000000001
  implements MigrationInterface
{
  name = 'AccountsUserIdDedupeMigration1778000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Sanity check — bail loudly if the prior migration's roles[] column isn't
    // here. TypeORM's migration ordering should prevent this, but assert anyway.
    const colExists: Array<{ exists: boolean }> = await queryRunner.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'accounts'
          AND column_name = 'roles'
      ) AS exists
    `);
    if (!colExists[0]?.exists) {
      throw new Error(
        'accounts.roles column is missing — AccountsRolesArrayMigration must run before this migration',
      );
    }

    await queryRunner.query(`
      DO $migrate$
      DECLARE
        canonical_id uuid;
        merged_roles "accounts_role_enum"[];
        merged_email varchar;
        merged_password varchar;
        -- accounts.creator_id is varchar in the schema (TypeORM @Column default
        -- for the string type), even though it stores UUID strings. Match it.
        merged_creator_id varchar;
        merged_profile_name varchar;
        non_canonical_ids uuid[];
        rec record;
        fk_ref record;
      BEGIN
        FOR rec IN
          SELECT "userId"
          FROM "accounts"
          WHERE deleted_at IS NULL
          GROUP BY "userId"
          HAVING COUNT(*) > 1
        LOOP
          -- Pick canonical:
          --   1. Real email (NOT @temp.facility) beats placeholder.
          --   2. Within real, prefer landlord > FM > tenant > anything else.
          --   3. Else oldest by created_at.
          SELECT id INTO canonical_id
          FROM "accounts"
          WHERE "userId" = rec."userId" AND deleted_at IS NULL
          ORDER BY
            CASE WHEN email LIKE '%@temp.facility' THEN 1 ELSE 0 END,
            CASE
              WHEN 'landlord' = ANY("roles")         THEN 0
              WHEN 'facility_manager' = ANY("roles") THEN 1
              WHEN 'tenant' = ANY("roles")           THEN 2
              ELSE 3
            END,
            created_at ASC
          LIMIT 1;

          -- Merge roles[] across all rows in the group (distinct).
          SELECT ARRAY(
            SELECT DISTINCT r
            FROM "accounts" a, unnest(a."roles") AS r
            WHERE a."userId" = rec."userId" AND a.deleted_at IS NULL
          ) INTO merged_roles;

          -- Canonical's email is what survives. If canonical is real, that's
          -- already optimal. If canonical's email is placeholder (only happens
          -- when ALL rows are placeholder), keep it as-is.
          SELECT email INTO merged_email
          FROM "accounts" WHERE id = canonical_id;

          -- Pick a usable password: prefer canonical's; else the first non-null
          -- non-empty password in the group.
          SELECT password INTO merged_password
          FROM "accounts"
          WHERE "userId" = rec."userId"
            AND deleted_at IS NULL
            AND password IS NOT NULL
            AND password <> ''
          ORDER BY CASE WHEN id = canonical_id THEN 0 ELSE 1 END, created_at ASC
          LIMIT 1;

          -- Pick a non-null creator_id, profile_name — prefer canonical's
          SELECT creator_id INTO merged_creator_id
          FROM "accounts"
          WHERE "userId" = rec."userId"
            AND deleted_at IS NULL
            AND creator_id IS NOT NULL
          ORDER BY CASE WHEN id = canonical_id THEN 0 ELSE 1 END
          LIMIT 1;

          SELECT profile_name INTO merged_profile_name
          FROM "accounts"
          WHERE "userId" = rec."userId"
            AND deleted_at IS NULL
            AND profile_name IS NOT NULL
          ORDER BY CASE WHEN id = canonical_id THEN 0 ELSE 1 END
          LIMIT 1;

          -- Update canonical with merged data
          UPDATE "accounts"
          SET "roles"       = merged_roles,
              "role"        = merged_roles[1],
              "email"       = merged_email,
              "password"    = COALESCE(merged_password, "password"),
              "creator_id"  = COALESCE(merged_creator_id, "creator_id"),
              "profile_name"= COALESCE(merged_profile_name, "profile_name"),
              "is_verified" = TRUE
          WHERE id = canonical_id;

          -- Collect non-canonical ids
          SELECT array_agg(id) INTO non_canonical_ids
          FROM "accounts"
          WHERE "userId" = rec."userId"
            AND deleted_at IS NULL
            AND id <> canonical_id;

          IF non_canonical_ids IS NOT NULL AND array_length(non_canonical_ids, 1) > 0 THEN
            -- Re-point every FK whose target is accounts.id to canonical.
            -- Discover them via information_schema so future-added FKs are
            -- handled without code changes here.
            FOR fk_ref IN
              SELECT
                kcu.table_name AS tbl,
                kcu.column_name AS col
              FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.referential_constraints rc
                  ON tc.constraint_name = rc.constraint_name
                JOIN information_schema.constraint_column_usage ccu
                  ON rc.unique_constraint_name = ccu.constraint_name
              WHERE tc.constraint_type = 'FOREIGN KEY'
                AND ccu.table_name = 'accounts'
                AND ccu.column_name = 'id'
                AND tc.table_schema = 'public'
            LOOP
              -- Cast both sides through text so the rerouting works whether
              -- the FK column is uuid (the common case) or varchar (e.g.
              -- accounts.creator_id, which stores UUID strings as text).
              EXECUTE format(
                'UPDATE %I SET %I = %L WHERE %I::text = ANY(%L::text[])',
                fk_ref.tbl, fk_ref.col, canonical_id, fk_ref.col, non_canonical_ids
              );
            END LOOP;

            -- Hard-delete the non-canonical rows.
            DELETE FROM "accounts" WHERE id = ANY(non_canonical_ids);
          END IF;
        END LOOP;
      END
      $migrate$;
    `);
  }

  public async down(): Promise<void> {
    // Same as the prior migration — duplicate-row collapse is not reversible
    // in any meaningful way. Leaving down() as a no-op rather than pretending
    // we can undo it.
  }
}
