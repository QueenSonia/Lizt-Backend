import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Convert accounts.role (scalar enum) → accounts.roles (enum[]),
 * collapse duplicate-email rows linked through the same users.id,
 * re-point all FKs to the canonical row, and add a unique constraint
 * on accounts.email.
 *
 * Multi-role login (one user with both LANDLORD and FACILITY_MANAGER roles)
 * needs a single accounts row per email so the picker can hand back the
 * full role list from one password check.
 *
 * The legacy scalar `role` column is kept (nullable) for back-compat with
 * existing read paths. A future cleanup will migrate `account.role === X`
 * reads to `account.roles.includes(X)` and drop the scalar.
 */
export class AccountsRolesArrayMigration1778000000000
  implements MigrationInterface
{
  name = 'AccountsRolesArrayMigration1778000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Find the actual enum type Postgres created for accounts.role.
    //    TypeORM names it like "accounts_role_enum" but we look it up to be safe.
    const enumTypeRows: Array<{ udt_name: string }> = await queryRunner.query(`
      SELECT udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'accounts'
        AND column_name = 'role'
      LIMIT 1
    `);

    if (!enumTypeRows.length) {
      throw new Error(
        'accounts.role column not found — cannot infer enum type for roles[]',
      );
    }
    const enumType = enumTypeRows[0].udt_name; // e.g. "accounts_role_enum"

    // 2. Add `roles` column (default empty array). Use IF NOT EXISTS so re-runs are safe.
    await queryRunner.query(`
      ALTER TABLE "accounts"
        ADD COLUMN IF NOT EXISTS "roles" "${enumType}"[] NOT NULL DEFAULT '{}'
    `);

    // 3. Backfill roles[] from the existing scalar role for any row not already populated.
    await queryRunner.query(`
      UPDATE "accounts"
        SET "roles" = ARRAY["role"]::"${enumType}"[]
      WHERE "role" IS NOT NULL
        AND (cardinality("roles") = 0 OR "roles" IS NULL)
    `);

    // 4. Make `role` nullable — `roles[]` is the source of truth from now on.
    await queryRunner.query(`
      ALTER TABLE "accounts" ALTER COLUMN "role" DROP NOT NULL
    `);

    // 5. Collapse duplicate-email rows.
    //    For each email with >1 active row, pick a canonical row (prefer landlord,
    //    else oldest), merge roles + password, re-point every FK that targets
    //    accounts.id, then delete the non-canonical rows.
    await queryRunner.query(`
      DO $migrate$
      DECLARE
        canonical_id uuid;
        merged_roles ${this.quote(enumType)}[];
        merged_password varchar;
        -- accounts.creator_id is varchar in the schema (TypeORM @Column default
        -- for the string type), even though it stores UUID strings. Match it.
        merged_creator_id varchar;
        merged_profile_name varchar;
        merged_user_id uuid;
        non_canonical_ids uuid[];
        rec record;
        fk_ref record;
      BEGIN
        FOR rec IN
          SELECT email
          FROM "accounts"
          WHERE deleted_at IS NULL
          GROUP BY email
          HAVING COUNT(*) > 1
        LOOP
          -- Pick canonical row: prefer landlord (user-set password), else oldest by created_at
          SELECT id INTO canonical_id
          FROM "accounts"
          WHERE email = rec.email AND deleted_at IS NULL
          ORDER BY
            CASE WHEN 'landlord' = ANY("roles") THEN 0 ELSE 1 END,
            created_at ASC
          LIMIT 1;

          -- Merge roles[] across all duplicates (distinct, preserving stable order)
          SELECT ARRAY(
            SELECT DISTINCT r
            FROM "accounts" a, unnest(a."roles") AS r
            WHERE a.email = rec.email AND a.deleted_at IS NULL
          ) INTO merged_roles;

          -- Pick a usable password — prefer canonical's; else the first non-null
          SELECT password INTO merged_password
          FROM "accounts"
          WHERE email = rec.email AND deleted_at IS NULL AND password IS NOT NULL
          ORDER BY CASE WHEN id = canonical_id THEN 0 ELSE 1 END, created_at ASC
          LIMIT 1;

          -- Pick a non-null creator_id, profile_name, userId — prefer canonical's
          SELECT creator_id INTO merged_creator_id
          FROM "accounts"
          WHERE email = rec.email AND deleted_at IS NULL AND creator_id IS NOT NULL
          ORDER BY CASE WHEN id = canonical_id THEN 0 ELSE 1 END
          LIMIT 1;

          SELECT profile_name INTO merged_profile_name
          FROM "accounts"
          WHERE email = rec.email AND deleted_at IS NULL AND profile_name IS NOT NULL
          ORDER BY CASE WHEN id = canonical_id THEN 0 ELSE 1 END
          LIMIT 1;

          SELECT "userId" INTO merged_user_id
          FROM "accounts"
          WHERE email = rec.email AND deleted_at IS NULL
          ORDER BY CASE WHEN id = canonical_id THEN 0 ELSE 1 END
          LIMIT 1;

          -- Update canonical row with merged data
          UPDATE "accounts"
          SET "roles" = merged_roles,
              "role" = merged_roles[1],
              "password" = COALESCE(merged_password, "password"),
              "creator_id" = COALESCE(merged_creator_id, "creator_id"),
              "profile_name" = COALESCE(merged_profile_name, "profile_name"),
              "userId" = merged_user_id,
              "is_verified" = TRUE
          WHERE id = canonical_id;

          -- Collect non-canonical ids
          SELECT array_agg(id) INTO non_canonical_ids
          FROM "accounts"
          WHERE email = rec.email AND deleted_at IS NULL AND id <> canonical_id;

          IF non_canonical_ids IS NOT NULL AND array_length(non_canonical_ids, 1) > 0 THEN
            -- Re-point every FK column whose target is accounts.id.
            -- Loop over information_schema so we catch all of them, including
            -- ones added by future migrations we haven't seen.
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

            -- Hard-delete the non-canonical rows (we want them gone, not just soft-deleted).
            DELETE FROM "accounts" WHERE id = ANY(non_canonical_ids);
          END IF;
        END LOOP;
      END
      $migrate$;
    `);

    // 6. Add unique partial index on email (matches the @Index in account.entity.ts,
    //    skipping soft-deleted rows so we can keep history without blocking re-use of
    //    the email after a hard removal).
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_accounts_email_unique"
        ON "accounts" ("email")
        WHERE deleted_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the unique index
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_accounts_email_unique"
    `);

    // Restore role NOT NULL — best-effort, fill from roles[0] if needed.
    // We can't reconstruct the deleted duplicate rows; this down is for partial rollback only.
    await queryRunner.query(`
      UPDATE "accounts"
        SET "role" = "roles"[1]
      WHERE "role" IS NULL AND cardinality("roles") > 0
    `);
    await queryRunner.query(`
      ALTER TABLE "accounts" ALTER COLUMN "role" SET NOT NULL
    `);

    // Drop the roles column
    await queryRunner.query(`
      ALTER TABLE "accounts" DROP COLUMN IF EXISTS "roles"
    `);
  }

  /** Quote an identifier like Postgres does — wrap in double-quotes, escape internal quotes. */
  private quote(ident: string): string {
    return `"${ident.replace(/"/g, '""')}"`;
  }
}
