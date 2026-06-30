import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the maintenance_requests.kind column and its enum type. The notice
 * feature it supported was removed — every item is just a maintenance request
 * again. Idempotent and safe on every environment:
 *  - dev (where the earlier kind/notice migration ran): drops the orphan column.
 *  - prod (which never ran it): DROP ... IF EXISTS is a no-op.
 *
 * The 'notice_open' value added to maintenance_requests_status_enum on dev is
 * left in place — Postgres can't drop an enum value without recreating the type,
 * and it is unused and harmless.
 */
export class DropMaintenanceKindColumn1912000000000
  implements MigrationInterface
{
  name = 'DropMaintenanceKindColumn1912000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "maintenance_requests" DROP COLUMN IF EXISTS "kind"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."maintenance_requests_kind_enum"`,
    );
  }

  public async down(): Promise<void> {
    // The notice feature was removed; nothing to restore.
  }
}
