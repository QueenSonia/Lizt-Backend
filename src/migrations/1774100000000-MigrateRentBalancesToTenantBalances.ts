import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migrate outstanding_balance and credit_balance from rent records into the
 * new tenant_balances table (grouped by tenant + landlord via property.owner_id).
 * Seeds a single MIGRATION ledger entry per (tenant, landlord) pair.
 */
export class MigrateRentBalancesToTenantBalances1774100000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Aggregate and upsert TenantBalance rows
    await queryRunner.query(`
      INSERT INTO "tenant_balances" (
        "tenant_id", "landlord_id", "outstanding_balance", "credit_balance"
      )
      SELECT
        r."tenant_id",
        p."owner_id"                          AS "landlord_id",
        SUM(COALESCE(r."outstanding_balance", 0)) AS "outstanding_balance",
        SUM(COALESCE(r."credit_balance", 0))     AS "credit_balance"
      FROM "rents" r
      JOIN "properties" p ON p."id" = r."property_id"
      WHERE
        COALESCE(r."outstanding_balance", 0) > 0
        OR COALESCE(r."credit_balance", 0) > 0
      GROUP BY r."tenant_id", p."owner_id"
      ON CONFLICT ("tenant_id", "landlord_id")
      DO UPDATE SET
        "outstanding_balance" = "tenant_balances"."outstanding_balance" + EXCLUDED."outstanding_balance",
        "credit_balance"      = "tenant_balances"."credit_balance"      + EXCLUDED."credit_balance"
    `);

    // 2. Seed one MIGRATION ledger entry per (tenant, landlord)
    await queryRunner.query(`
      INSERT INTO "tenant_balance_ledger" (
        "tenant_id", "landlord_id", "type", "description",
        "outstanding_balance_change", "credit_balance_change",
        "outstanding_balance_after",  "credit_balance_after"
      )
      SELECT
        tb."tenant_id",
        tb."landlord_id",
        'migration',
        'Balance migrated from previous rent records',
        tb."outstanding_balance",
        tb."credit_balance",
        tb."outstanding_balance",
        tb."credit_balance"
      FROM "tenant_balances" tb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove migrated data — original columns still exist at this point
    await queryRunner.query(`
      DELETE FROM "tenant_balance_ledger" WHERE "type" = 'migration'
    `);
    await queryRunner.query(`TRUNCATE TABLE "tenant_balances"`);
  }
}
