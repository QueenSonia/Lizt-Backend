import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Billing v2 — adds a `metadata` JSONB column to `tenant_balance_ledger`.
 *
 * The new `one_time_fees` type is a TS-level enum addition only; the DB
 * column is VARCHAR(50) (see 1774000000000-CreateTenantBalanceTables), so
 * no DDL is needed to accept the new value.
 *
 * The metadata column is used to tag billing-v2 writes with
 *   { "batch_id": "billing-v2", ... }
 * so reversal SQL can target them precisely.
 */
export class AddOneTimeFeesLedgerType1775000000006
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_balance_ledger"
        ADD COLUMN "metadata" JSONB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "tenant_balance_ledger"
        DROP COLUMN "metadata"
    `);
  }
}
