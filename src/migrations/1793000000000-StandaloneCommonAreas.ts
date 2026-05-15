import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Promotes common areas to a first-class entity.
 *
 * Up:
 *  1. Create `common_areas` (landlord-owned: owner_id → users.id).
 *  2. Wipe legacy `service_requests` rows with scope='common_area' (and their
 *     status_history fan-out). These rows were property-scoped under the old
 *     model and have no `common_area_id` we can backfill into — deleting them
 *     is the user-chosen policy. THIS IS DESTRUCTIVE AND IRREVERSIBLE.
 *  3. Add `common_area_id` to `service_requests` (FK SET NULL on CA delete,
 *     indexed).
 *  4. Drop NOT NULL on `service_requests.property_id` and `property_name`
 *     (common-area requests carry no property).
 *
 * Down: reverses 1, 3, 4. Cannot resurrect the legacy rows deleted in 2.
 */
export class StandaloneCommonAreas1793000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "common_areas" (
        "id"         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "owner_id"   uuid NOT NULL,
        "name"       varchar(120) NOT NULL,
        "address"    text NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP NULL,
        CONSTRAINT "fk_common_areas_owner"
          FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_common_areas_owner_id" ON "common_areas" ("owner_id")`,
    );

    // Wipe legacy common-area service requests + their status history. Order
    // matters because status_history has a FK to service_requests.
    await queryRunner.query(`
      DELETE FROM "service_request_status_history"
      WHERE "service_request_id" IN (
        SELECT "id" FROM "service_requests" WHERE "scope" = 'common_area'
      )
    `);
    await queryRunner.query(
      `DELETE FROM "service_requests" WHERE "scope" = 'common_area'`,
    );

    // Drop the old `(property_id, scope)` index — we're about to make
    // property_id nullable and add a dedicated common_area_id column. Both
    // halves of the old index are touched.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_service_requests_property_scope"`,
    );

    await queryRunner.query(`
      ALTER TABLE "service_requests"
        ADD COLUMN IF NOT EXISTS "common_area_id" uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "service_requests"
        ADD CONSTRAINT "fk_service_requests_common_area"
        FOREIGN KEY ("common_area_id")
        REFERENCES "common_areas"("id")
        ON DELETE SET NULL
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_service_requests_common_area_id" ON "service_requests" ("common_area_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "service_requests" ALTER COLUMN "property_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_requests" ALTER COLUMN "property_name" DROP NOT NULL`,
    );

    // Re-add the property+scope composite index, now allowing null property_id.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_requests_property_scope"
        ON "service_requests" ("property_id", "scope")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // We can't restore deleted common-area service requests. We can only undo
    // the schema additions. Restoring NOT NULL on property_id/property_name
    // would fail if any rows have NULLs — error loudly so the operator can
    // decide what to do rather than silently letting bad state through.

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_service_requests_property_scope"`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_service_requests_common_area_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_requests" DROP CONSTRAINT IF EXISTS "fk_service_requests_common_area"`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_requests" DROP COLUMN IF EXISTS "common_area_id"`,
    );

    // Attempt to restore NOT NULL; if rows are now NULL because common-area
    // requests were created during the new regime, this will throw.
    await queryRunner.query(
      `ALTER TABLE "service_requests" ALTER COLUMN "property_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_requests" ALTER COLUMN "property_name" SET NOT NULL`,
    );

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_requests_property_scope"
        ON "service_requests" ("property_id", "scope")
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_common_areas_owner_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "common_areas"`);
  }
}
