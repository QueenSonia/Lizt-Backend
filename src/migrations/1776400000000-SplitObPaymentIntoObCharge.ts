import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Historically `OB_PAYMENT` was used for both debits (new charge, negative
 * `balance_change`) and credits (tenant paid, positive `balance_change`).
 * Reports that count "outstanding-balance payments received" were therefore
 * mixing collection with billing.
 *
 * This migration reclassifies the debits to the new `OB_CHARGE` type based
 * on sign. The DB `type` column is VARCHAR(50), so the enum change is
 * TS-only — no DDL is needed.
 */
export class SplitObPaymentIntoObCharge1776400000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "tenant_balance_ledger"
         SET "type" = 'ob_charge'
       WHERE "type" = 'ob_payment'
         AND "balance_change" < 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "tenant_balance_ledger"
         SET "type" = 'ob_payment'
       WHERE "type" = 'ob_charge'
    `);
  }
}
