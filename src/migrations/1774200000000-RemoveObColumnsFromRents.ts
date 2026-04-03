import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove outstanding_balance, outstanding_balance_reason, original_expiry_date,
 * and credit_balance from the rents table.
 *
 * These values now live in tenant_balances / tenant_balance_ledger and are
 * tracked at the (tenant, landlord) scope rather than per-rent-record.
 *
 * Run AFTER 1774100000000-MigrateRentBalancesToTenantBalances.
 */
export class RemoveObColumnsFromRents1774200000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rents"
        DROP COLUMN IF EXISTS "outstanding_balance",
        DROP COLUMN IF EXISTS "outstanding_balance_reason",
        DROP COLUMN IF EXISTS "original_expiry_date",
        DROP COLUMN IF EXISTS "credit_balance"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rents"
        ADD COLUMN "outstanding_balance"        INTEGER DEFAULT 0,
        ADD COLUMN "outstanding_balance_reason" TEXT,
        ADD COLUMN "original_expiry_date"       TIMESTAMP,
        ADD COLUMN "credit_balance"             INTEGER DEFAULT 0
    `);
  }
}
