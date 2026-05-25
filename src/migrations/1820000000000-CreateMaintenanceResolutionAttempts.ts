import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `maintenance_resolution_attempts` — one row per FM resolve cycle.
 * Carries the snapshot (summary, category, cost, artisan, resolved_by) plus
 * an outcome (`pending | confirmed | denied | reopened`) and the tenant's
 * denial reason if/when it arrives. The MR row's own resolution_* columns
 * remain as a "latest attempt" projection used by other read paths.
 *
 * Backfill: for every MR with resolution_date IS NOT NULL we insert one
 * attempt row using the current snapshot columns. Outcome is derived from
 * the MR's current status; older attempts in the same MR's history are NOT
 * synthesized (we don't have their snapshots — they were overwritten on each
 * subsequent resolve). New cycles starting after this migration will produce
 * a fresh row per resolve.
 */
export class CreateMaintenanceResolutionAttempts1820000000000
  implements MigrationInterface
{
  name = 'CreateMaintenanceResolutionAttempts1820000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'maintenance_resolution_attempts_outcome_enum') THEN
          CREATE TYPE "maintenance_resolution_attempts_outcome_enum" AS ENUM (
            'pending', 'confirmed', 'denied', 'reopened'
          );
        END IF;
      END$$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "maintenance_resolution_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP NULL,
        "maintenance_request_id" uuid NOT NULL,
        "attempt_number" integer NOT NULL,
        "resolution_date" TIMESTAMP NOT NULL,
        "resolution_category" varchar(64) NOT NULL,
        "resolution_summary" text NOT NULL,
        "resolution_cost_minor" integer NULL,
        "artisan_id" uuid NULL,
        "artisan_name_snapshot" varchar NULL,
        "artisan_phone_snapshot" varchar NULL,
        "resolved_by_user_id" uuid NULL,
        "resolved_by_name_snapshot" varchar NULL,
        "outcome" "maintenance_resolution_attempts_outcome_enum"
          NOT NULL DEFAULT 'pending',
        "outcome_decided_at" TIMESTAMP NULL,
        "tenant_denial_reason" text NULL,
        CONSTRAINT "pk_maintenance_resolution_attempts_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_mra_maintenance_request" FOREIGN KEY ("maintenance_request_id")
          REFERENCES "maintenance_requests" ("id") ON DELETE CASCADE,
        CONSTRAINT "fk_mra_artisan" FOREIGN KEY ("artisan_id")
          REFERENCES "artisans" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_mra_resolved_by_user" FOREIGN KEY ("resolved_by_user_id")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "uq_maintenance_resolution_attempts_request_number"
          UNIQUE ("maintenance_request_id", "attempt_number")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_mra_request_attempt"
        ON "maintenance_resolution_attempts" ("maintenance_request_id", "attempt_number")
    `);

    // Backfill: one attempt row per MR that has ever been resolved.
    // Outcome maps from current MR status:
    //   closed              → confirmed
    //   denied_by_tenant    → denied (denial_reason ← rejection_reason)
    //   reopened            → reopened
    //   resolved / pending_tenant_confirmation → pending
    //   anything else (rejected, etc.) → pending (defensive, shouldn't occur
    //     when resolution_date IS NOT NULL)
    await queryRunner.query(`
      INSERT INTO "maintenance_resolution_attempts" (
        "maintenance_request_id",
        "attempt_number",
        "resolution_date",
        "resolution_category",
        "resolution_summary",
        "resolution_cost_minor",
        "artisan_id",
        "artisan_name_snapshot",
        "artisan_phone_snapshot",
        "outcome",
        "outcome_decided_at",
        "tenant_denial_reason"
      )
      SELECT
        mr."id",
        1,
        mr."resolution_date",
        COALESCE(mr."resolution_category", 'other'),
        COALESCE(mr."resolution_summary", '(snapshot unavailable)'),
        mr."resolution_cost_minor",
        mr."artisan_id",
        mr."artisan_name_snapshot",
        mr."artisan_phone_snapshot",
        CASE mr."status"
          WHEN 'closed' THEN 'confirmed'::maintenance_resolution_attempts_outcome_enum
          WHEN 'denied_by_tenant' THEN 'denied'::maintenance_resolution_attempts_outcome_enum
          WHEN 'reopened' THEN 'reopened'::maintenance_resolution_attempts_outcome_enum
          ELSE 'pending'::maintenance_resolution_attempts_outcome_enum
        END,
        CASE
          WHEN mr."status" IN ('closed', 'denied_by_tenant', 'reopened')
            THEN COALESCE(mr."reopened_at", mr."updated_at")
          ELSE NULL
        END,
        CASE
          WHEN mr."status" = 'denied_by_tenant' THEN mr."rejection_reason"
          ELSE NULL
        END
      FROM "maintenance_requests" mr
      WHERE mr."resolution_date" IS NOT NULL
      ON CONFLICT ("maintenance_request_id", "attempt_number") DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_mra_request_attempt"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "maintenance_resolution_attempts"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "maintenance_resolution_attempts_outcome_enum"`,
    );
  }
}
