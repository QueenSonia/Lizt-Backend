import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FM-created service requests have no tenant — they're scoped to a property
 * (or its common areas) by the FM directly. Drop NOT NULL on tenant_id so
 * those rows can persist without a fake tenant. FK and ON DELETE behavior
 * unchanged.
 */
export class MakeServiceRequestTenantIdNullable1790000000001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "service_requests"
        ALTER COLUMN "tenant_id" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort restore. Refuse if any FM-created rows exist with NULL
    // tenant_id — restoring NOT NULL would otherwise fail the constraint.
    const nullRows = await queryRunner.query(`
      SELECT COUNT(*)::int AS count FROM "service_requests" WHERE "tenant_id" IS NULL
    `);
    if (Number(nullRows?.[0]?.count ?? 0) > 0) {
      throw new Error(
        'Cannot revert MakeServiceRequestTenantIdNullable: rows with NULL tenant_id exist. Backfill or delete them first.',
      );
    }
    await queryRunner.query(`
      ALTER TABLE "service_requests"
        ALTER COLUMN "tenant_id" SET NOT NULL
    `);
  }
}
