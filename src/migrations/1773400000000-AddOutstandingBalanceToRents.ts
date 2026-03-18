import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add outstanding_balance and outstanding_balance_reason columns to rents table.
 *
 * These columns track any unpaid rent a tenant already owes before being
 * onboarded via the KYC attach flow.
 */
export class AddOutstandingBalanceToRents1773400000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rents"
      ADD COLUMN "outstanding_balance" INTEGER DEFAULT 0,
      ADD COLUMN "outstanding_balance_reason" TEXT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rents"
      DROP COLUMN "outstanding_balance_reason",
      DROP COLUMN "outstanding_balance"
    `);
  }
}
