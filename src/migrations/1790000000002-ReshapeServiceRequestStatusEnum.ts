import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reshapes the service-request status enum from the legacy 7-value set to the
 * canonical 5: not_approved, approved, resolved, reopened, closed.
 *
 *   pending / open / urgent  →  not_approved   (urgent's flag survives in is_urgent)
 *   in_progress              →  approved
 *   resolved / closed / reopened → unchanged
 *
 * Mapping is case-insensitive to handle stray uppercase legacy values added
 * by 1763981310757-UpdateServiceRequestSchema (which were never written by
 * application code but exist in the type).
 *
 * MUST run after AddServiceRequestScopeAndCreatorColumns so the urgent flag
 * is captured in is_urgent before the cast erases the urgent status value.
 */
export class ReshapeServiceRequestStatusEnum1790000000002
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── service_requests.status ──
    await queryRunner.query(
      `CREATE TYPE "public"."service_requests_status_enum_new" AS ENUM ('not_approved', 'approved', 'resolved', 'reopened', 'closed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_requests" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(`
      ALTER TABLE "service_requests"
        ALTER COLUMN "status" TYPE "public"."service_requests_status_enum_new"
        USING (
          CASE LOWER("status"::text)
            WHEN 'pending' THEN 'not_approved'
            WHEN 'open' THEN 'not_approved'
            WHEN 'urgent' THEN 'not_approved'
            WHEN 'in_progress' THEN 'approved'
            WHEN 'resolved' THEN 'resolved'
            WHEN 'closed' THEN 'closed'
            WHEN 'reopened' THEN 'reopened'
            ELSE 'not_approved'
          END
        )::"public"."service_requests_status_enum_new"
    `);
    await queryRunner.query(
      `ALTER TABLE "service_requests" ALTER COLUMN "status" SET DEFAULT 'not_approved'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."service_requests_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."service_requests_status_enum_new" RENAME TO "service_requests_status_enum"`,
    );

    // ── service_request_status_history.previous_status ── (nullable)
    await queryRunner.query(
      `CREATE TYPE "public"."service_request_status_history_previous_status_enum_new" AS ENUM ('not_approved', 'approved', 'resolved', 'reopened', 'closed')`,
    );
    await queryRunner.query(`
      ALTER TABLE "service_request_status_history"
        ALTER COLUMN "previous_status" TYPE "public"."service_request_status_history_previous_status_enum_new"
        USING (
          CASE
            WHEN "previous_status" IS NULL THEN NULL
            ELSE (
              CASE LOWER("previous_status"::text)
                WHEN 'pending' THEN 'not_approved'
                WHEN 'open' THEN 'not_approved'
                WHEN 'urgent' THEN 'not_approved'
                WHEN 'in_progress' THEN 'approved'
                WHEN 'resolved' THEN 'resolved'
                WHEN 'closed' THEN 'closed'
                WHEN 'reopened' THEN 'reopened'
                ELSE 'not_approved'
              END
            )::"public"."service_request_status_history_previous_status_enum_new"
          END
        )
    `);
    await queryRunner.query(
      `DROP TYPE "public"."service_request_status_history_previous_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."service_request_status_history_previous_status_enum_new" RENAME TO "service_request_status_history_previous_status_enum"`,
    );

    // ── service_request_status_history.new_status ── (NOT NULL)
    await queryRunner.query(
      `CREATE TYPE "public"."service_request_status_history_new_status_enum_new" AS ENUM ('not_approved', 'approved', 'resolved', 'reopened', 'closed')`,
    );
    await queryRunner.query(`
      ALTER TABLE "service_request_status_history"
        ALTER COLUMN "new_status" TYPE "public"."service_request_status_history_new_status_enum_new"
        USING (
          CASE LOWER("new_status"::text)
            WHEN 'pending' THEN 'not_approved'
            WHEN 'open' THEN 'not_approved'
            WHEN 'urgent' THEN 'not_approved'
            WHEN 'in_progress' THEN 'approved'
            WHEN 'resolved' THEN 'resolved'
            WHEN 'closed' THEN 'closed'
            WHEN 'reopened' THEN 'reopened'
            ELSE 'not_approved'
          END
        )::"public"."service_request_status_history_new_status_enum_new"
    `);
    await queryRunner.query(
      `DROP TYPE "public"."service_request_status_history_new_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."service_request_status_history_new_status_enum_new" RENAME TO "service_request_status_history_new_status_enum"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort restore of the 7-value enum. is_urgent rows lose nothing
    // since is_urgent is a separate column managed by AddServiceRequestScope...
    // migration's down().
    const oldValues = `'pending', 'open', 'in_progress', 'resolved', 'closed', 'reopened', 'urgent'`;

    // ── service_requests.status ──
    await queryRunner.query(
      `CREATE TYPE "public"."service_requests_status_enum_old" AS ENUM (${oldValues})`,
    );
    await queryRunner.query(
      `ALTER TABLE "service_requests" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(`
      ALTER TABLE "service_requests"
        ALTER COLUMN "status" TYPE "public"."service_requests_status_enum_old"
        USING (
          CASE "status"::text
            WHEN 'not_approved' THEN 'pending'
            WHEN 'approved' THEN 'in_progress'
            ELSE "status"::text
          END
        )::"public"."service_requests_status_enum_old"
    `);
    await queryRunner.query(
      `ALTER TABLE "service_requests" ALTER COLUMN "status" SET DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `DROP TYPE "public"."service_requests_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."service_requests_status_enum_old" RENAME TO "service_requests_status_enum"`,
    );

    // ── history.previous_status ──
    await queryRunner.query(
      `CREATE TYPE "public"."service_request_status_history_previous_status_enum_old" AS ENUM (${oldValues})`,
    );
    await queryRunner.query(`
      ALTER TABLE "service_request_status_history"
        ALTER COLUMN "previous_status" TYPE "public"."service_request_status_history_previous_status_enum_old"
        USING (
          CASE
            WHEN "previous_status" IS NULL THEN NULL
            ELSE (
              CASE "previous_status"::text
                WHEN 'not_approved' THEN 'pending'
                WHEN 'approved' THEN 'in_progress'
                ELSE "previous_status"::text
              END
            )::"public"."service_request_status_history_previous_status_enum_old"
          END
        )
    `);
    await queryRunner.query(
      `DROP TYPE "public"."service_request_status_history_previous_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."service_request_status_history_previous_status_enum_old" RENAME TO "service_request_status_history_previous_status_enum"`,
    );

    // ── history.new_status ──
    await queryRunner.query(
      `CREATE TYPE "public"."service_request_status_history_new_status_enum_old" AS ENUM (${oldValues})`,
    );
    await queryRunner.query(`
      ALTER TABLE "service_request_status_history"
        ALTER COLUMN "new_status" TYPE "public"."service_request_status_history_new_status_enum_old"
        USING (
          CASE "new_status"::text
            WHEN 'not_approved' THEN 'pending'
            WHEN 'approved' THEN 'in_progress'
            ELSE "new_status"::text
          END
        )::"public"."service_request_status_history_new_status_enum_old"
    `);
    await queryRunner.query(
      `DROP TYPE "public"."service_request_status_history_new_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."service_request_status_history_new_status_enum_old" RENAME TO "service_request_status_history_new_status_enum"`,
    );
  }
}
