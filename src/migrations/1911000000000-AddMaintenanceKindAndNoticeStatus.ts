import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tenant AI receptionist — notice support.
 *
 * Adds a `kind` ('repair' | 'notice') column to maintenance_requests and a
 * `notice_open` status value. A notice is an informational message a tenant
 * sends for the landlord (no FM, landlord-ack lifecycle): created `notice_open`,
 * acknowledged → `closed`. Existing rows backfill to `repair`, so every prior
 * request and all non-notice paths stay repairs and behave exactly as before.
 *
 * Also adds the 'Tenant Handoff' notification-enum value, written by
 * TenantAiService when a tenant is handed off to a human on the landlord feed
 * (mirrors 'Applicant Handoff' from migration 1910).
 *
 * DDL-only: no statement inserts a row using the new enum values, so the
 * Postgres "ADD VALUE then use in same transaction" restriction does not apply.
 */
export class AddMaintenanceKindAndNoticeStatus1911000000000
  implements MigrationInterface
{
  name = 'AddMaintenanceKindAndNoticeStatus1911000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. New status value for the notice 'open' state.
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'notice_open'
          AND enumtypid = (
            SELECT oid FROM pg_type WHERE typname = 'maintenance_requests_status_enum'
          )
        ) THEN
          ALTER TYPE "public"."maintenance_requests_status_enum" ADD VALUE 'notice_open';
        END IF;
      END $$;`,
    );

    // 2. kind enum type + column (default 'repair' backfills existing rows).
    await queryRunner.query(
      `DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'maintenance_requests_kind_enum'
        ) THEN
          CREATE TYPE "public"."maintenance_requests_kind_enum" AS ENUM ('repair', 'notice');
        END IF;
      END $$;`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance_requests"
       ADD COLUMN IF NOT EXISTS "kind" "public"."maintenance_requests_kind_enum"
       NOT NULL DEFAULT 'repair'`,
    );

    // 3. Notification enum value for tenant → landlord handoff.
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Tenant Handoff'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The kind column can be dropped, but Postgres can't remove an enum value
    // without rebuilding the type, so 'notice_open' and 'Tenant Handoff' are
    // left in place. Drop the column and its type only.
    await queryRunner.query(
      `ALTER TABLE "maintenance_requests" DROP COLUMN IF EXISTS "kind"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."maintenance_requests_kind_enum"`,
    );
    console.log(
      'Warning: enum values "notice_open" and "Tenant Handoff" cannot be ' +
        'automatically removed. Manual intervention required if rollback is necessary.',
    );
  }
}
