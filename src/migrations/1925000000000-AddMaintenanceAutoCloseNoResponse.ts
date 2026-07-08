import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supports capping the resolved-confirmation reminders at 2 and auto-closing a
 * unit-scoped maintenance request when the tenant never responds
 * (MaintenanceReminderService). Three schema additions:
 *
 *  1. `expired` on the resolution-attempt outcome enum — the attempt outcome
 *     stamped when a request is auto-closed with no tenant response, so
 *     reporting can tell it apart from a genuine `confirmed`.
 *  2. `Maintenance Confirmation Reminder` + `Maintenance Auto Closed` on the
 *     notifications enum — the two live-feed row types the cron now writes
 *     (the landlord Live Feed reads the `notifications` table). Mirrors the
 *     installment-reminder precedent (migration 1917).
 *  3. `auto_closed` boolean on `maintenance_requests` — lets the frontend show
 *     a small "Auto-closed" tag on Closed requests without an extra fetch.
 *
 * None of the added enum values are USED in this migration (only defined), so
 * the ALTER TYPE ... ADD VALUE calls are safe inside TypeORM's per-migration
 * transaction on PG 12+.
 *
 * Numbered 1925 to sit clear of in-flight migrations on sibling branches
 * (1923/1924 pending deploy on feature/property-manager-dashboard).
 */
export class AddMaintenanceAutoCloseNoResponse1925000000000
  implements MigrationInterface
{
  name = 'AddMaintenanceAutoCloseNoResponse1925000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."maintenance_resolution_attempts_outcome_enum" ADD VALUE IF NOT EXISTS 'expired'`,
    );

    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Maintenance Confirmation Reminder'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."notification_type_enum" ADD VALUE IF NOT EXISTS 'Maintenance Auto Closed'`,
    );

    await queryRunner.query(
      `ALTER TABLE "maintenance_requests" ADD COLUMN IF NOT EXISTS "auto_closed" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "maintenance_requests" DROP COLUMN IF EXISTS "auto_closed"`,
    );
    // Postgres cannot drop a value from an enum type without recreating it.
    // Leave the added enum values in place on rollback (harmless if unused).
  }
}
