import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds two columns to `maintenance_requests` powering the FM priority +
 * tasks-list ordering work:
 *
 *   - `is_priority` (boolean, default false) — landlord-set flag, surfaced as
 *     an orange "Priority" pill across FM/landlord views.
 *   - `approved_at` (timestamptz, nullable) — denormalized "last became
 *     actionable" timestamp, updated when a request transitions into
 *     APPROVED or REOPENED. Used to rank freshly-actionable tasks above
 *     stale ones on the FM tasks list and dashboard.
 *
 * Backfill: for each existing request, set `approved_at` to the most recent
 * `changed_at` from `maintenance_request_status_history` where `new_status`
 * is `approved` or `reopened`. Requests that never reached either status
 * keep `approved_at = NULL`.
 */
export class AddPriorityAndApprovedAtToMaintenanceRequests1800000000000
  implements MigrationInterface
{
  name = 'AddPriorityAndApprovedAtToMaintenanceRequests1800000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "maintenance_requests"
       ADD COLUMN IF NOT EXISTS "is_priority" boolean NOT NULL DEFAULT false;`,
    );

    await queryRunner.query(
      `ALTER TABLE "maintenance_requests"
       ADD COLUMN IF NOT EXISTS "approved_at" timestamp with time zone NULL;`,
    );

    await queryRunner.query(
      `UPDATE "maintenance_requests" mr
       SET "approved_at" = sub.changed_at
       FROM (
         SELECT maintenance_request_id, MAX(changed_at) AS changed_at
         FROM "maintenance_request_status_history"
         WHERE new_status IN ('approved', 'reopened')
         GROUP BY maintenance_request_id
       ) sub
       WHERE mr.id = sub.maintenance_request_id
         AND mr."approved_at" IS NULL;`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_mr_priority_approved_at"
       ON "maintenance_requests" ("is_priority" DESC, "approved_at" DESC NULLS LAST);`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_mr_priority_approved_at";`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance_requests" DROP COLUMN IF EXISTS "approved_at";`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance_requests" DROP COLUMN IF EXISTS "is_priority";`,
    );
  }
}
