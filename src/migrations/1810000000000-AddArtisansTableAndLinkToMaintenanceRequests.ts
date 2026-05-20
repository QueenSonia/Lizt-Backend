import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `artisans` table (tradesperson contact records scoped to a
 * landlord's Team) and links `maintenance_requests` to it via:
 *   - artisan_id (FK, ON DELETE SET NULL — historical resolutions survive
 *     artisan-row deletion)
 *   - artisan_name_snapshot / artisan_phone_snapshot — captured at resolve
 *     time so any later rename / cleanup leaves the historical record intact.
 *
 * The phone-canonical CHECK constraint mirrors users.phone_number
 * (see 1775000000007-AddUserPhoneCanonicalCheck) — belt-and-braces against
 * any write path that skips the service-layer normalization.
 */
export class AddArtisansTableAndLinkToMaintenanceRequests1810000000000
  implements MigrationInterface
{
  name = 'AddArtisansTableAndLinkToMaintenanceRequests1810000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "artisans" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP NULL,
        "team_id" uuid NOT NULL,
        "name" varchar NOT NULL,
        "phone" varchar NOT NULL,
        "created_by_account_id" uuid NOT NULL,
        CONSTRAINT "pk_artisans_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_artisans_team" FOREIGN KEY ("team_id")
          REFERENCES "team" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_artisans_created_by_account" FOREIGN KEY ("created_by_account_id")
          REFERENCES "accounts" ("id") ON DELETE RESTRICT,
        CONSTRAINT "artisans_phone_canonical"
          CHECK (phone ~ '^234[0-9]{10}$')
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_artisans_team_phone"
        ON "artisans" ("team_id", "phone")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_artisans_team_id"
        ON "artisans" ("team_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "maintenance_requests"
        ADD COLUMN IF NOT EXISTS "artisan_id" uuid NULL,
        ADD COLUMN IF NOT EXISTS "artisan_name_snapshot" varchar NULL,
        ADD COLUMN IF NOT EXISTS "artisan_phone_snapshot" varchar NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "maintenance_requests"
        ADD CONSTRAINT "fk_maintenance_requests_artisan"
        FOREIGN KEY ("artisan_id") REFERENCES "artisans" ("id")
        ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_maintenance_requests_artisan_id"
        ON "maintenance_requests" ("artisan_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_maintenance_requests_artisan_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance_requests"
         DROP CONSTRAINT IF EXISTS "fk_maintenance_requests_artisan"`,
    );
    await queryRunner.query(`
      ALTER TABLE "maintenance_requests"
        DROP COLUMN IF EXISTS "artisan_phone_snapshot",
        DROP COLUMN IF EXISTS "artisan_name_snapshot",
        DROP COLUMN IF EXISTS "artisan_id"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_artisans_team_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_artisans_team_phone"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "artisans"`);
  }
}
