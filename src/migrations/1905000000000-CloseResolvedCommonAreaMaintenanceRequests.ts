import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Common-area maintenance requests have no tenant, so the resolve → tenant
 * confirmation → closed gate can never advance for them: once an FM marks one
 * resolved it sits in `resolved` ("awaiting tenant confirmation") forever.
 * Going forward the app auto-closes these on resolve, but rows resolved before
 * that change are stranded. This backfill closes them out.
 *
 * Two writes, matching what the runtime auto-close does:
 *   1. Patch each stranded request's latest resolution attempt from `pending`
 *      to `confirmed` (the FM/landlord UI keys its "Awaiting tenant
 *      confirmation" banner on the attempt outcome, not the request status —
 *      leaving it `pending` would keep the banner on a closed request).
 *   2. Flip the request status `resolved` → `closed`.
 *
 * Done attempts-first so the join still targets the `resolved` set, and only
 * `pending` attempts are touched (a `denied`/`reopened` latest attempt is left
 * alone — those aren't the stuck-awaiting case). No status_history row is
 * written: changed_by_user_id is a NOT NULL FK to users.id and a backfill has
 * no actor — same as the runtime helper, which skips the audit row for
 * system-initiated closes.
 *
 * Observed at write time: prod/main 8 rows, dev 0 (no-op). Scoped so re-running
 * after the runtime change ships is a safe no-op (nothing left in `resolved`).
 */
export class CloseResolvedCommonAreaMaintenanceRequests1905000000000
  implements MigrationInterface
{
  name = 'CloseResolvedCommonAreaMaintenanceRequests1905000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Confirm the latest resolution attempt for each stranded request.
    await queryRunner.query(`
      UPDATE "maintenance_resolution_attempts" a
      SET "outcome" = 'confirmed',
          "outcome_decided_at" = now()
      FROM "maintenance_requests" mr
      WHERE a."maintenance_request_id" = mr."id"
        AND mr."scope" = 'common_area'
        AND mr."status" = 'resolved'
        AND mr."deleted_at" IS NULL
        AND a."outcome" = 'pending'
        AND a."attempt_number" = (
          SELECT max("attempt_number")
          FROM "maintenance_resolution_attempts"
          WHERE "maintenance_request_id" = mr."id"
        );
    `);

    // 2. Close the requests themselves.
    await queryRunner.query(`
      UPDATE "maintenance_requests"
      SET "status" = 'closed',
          "updated_at" = now()
      WHERE "scope" = 'common_area'
        AND "status" = 'resolved'
        AND "deleted_at" IS NULL;
    `);
  }

  public async down(): Promise<void> {
    // `closed` is the normal terminal state for common-area requests (the
    // runtime now lands them there directly), so a down migration can't tell
    // the rows closed by this backfill apart from those closed legitimately.
    // No safe automatic rollback.
    console.log(
      'Warning: CloseResolvedCommonAreaMaintenanceRequests cannot be ' +
        'automatically rolled back. Manual intervention required.',
    );
  }
}
