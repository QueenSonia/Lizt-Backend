import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the FM-creator and common-area scope columns to service_requests, plus
 * an independent `is_urgent` boolean. Backfills `is_urgent` from rows that are
 * currently `urgent` and from any history row that ever transitioned a request
 * to `urgent` — must run BEFORE the status enum reshape, otherwise the cast
 * would erase the urgent signal.
 */
export class AddServiceRequestScopeAndCreatorColumns1790000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."service_request_scope_enum" AS ENUM ('unit', 'common_area')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."service_request_creator_type_enum" AS ENUM ('tenant', 'facility_manager')`,
    );

    await queryRunner.query(`
      ALTER TABLE "service_requests"
        ADD COLUMN IF NOT EXISTS "is_urgent" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "scope" "public"."service_request_scope_enum" NOT NULL DEFAULT 'unit',
        ADD COLUMN IF NOT EXISTS "creator_type" "public"."service_request_creator_type_enum" NOT NULL DEFAULT 'tenant',
        ADD COLUMN IF NOT EXISTS "creator_user_id" uuid NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "service_requests"
        ADD CONSTRAINT "fk_service_requests_creator_user"
        FOREIGN KEY ("creator_user_id")
        REFERENCES "users"("id")
        ON DELETE SET NULL
    `);

    // Backfill is_urgent from any row whose current status is 'urgent' OR
    // whose history ever recorded a transition to 'urgent'. Runs before the
    // enum reshape so both lookups still work.
    await queryRunner.query(`
      UPDATE "service_requests" sr
      SET "is_urgent" = true
      WHERE LOWER(sr."status"::text) = 'urgent'
         OR EXISTS (
           SELECT 1 FROM "service_request_status_history" h
           WHERE h."service_request_id" = sr."id"
             AND LOWER(h."new_status"::text) = 'urgent'
         )
    `);

    // Backfill creator_user_id for tenant-created rows: resolve tenant_id
    // (accounts.id) -> users.id via accounts."userId" (quoted because the
    // schema uses camelCase for this column).
    await queryRunner.query(`
      UPDATE "service_requests" sr
      SET "creator_user_id" = a."userId"
      FROM "accounts" a
      WHERE sr."tenant_id" = a."id"
        AND sr."creator_user_id" IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_requests_property_scope"
        ON "service_requests" ("property_id", "scope")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_requests_creator_type"
        ON "service_requests" ("creator_type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_service_requests_is_urgent"
        ON "service_requests" ("is_urgent")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_service_requests_is_urgent"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_service_requests_creator_type"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_service_requests_property_scope"`,
    );
    await queryRunner.query(`
      ALTER TABLE "service_requests"
        DROP CONSTRAINT IF EXISTS "fk_service_requests_creator_user"
    `);
    await queryRunner.query(`
      ALTER TABLE "service_requests"
        DROP COLUMN IF EXISTS "creator_user_id",
        DROP COLUMN IF EXISTS "creator_type",
        DROP COLUMN IF EXISTS "scope",
        DROP COLUMN IF EXISTS "is_urgent"
    `);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."service_request_creator_type_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."service_request_scope_enum"`,
    );
  }
}
