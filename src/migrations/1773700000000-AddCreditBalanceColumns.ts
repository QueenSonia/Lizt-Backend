import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add credit_balance columns to rents, offer_letters, and invoices tables.
 *
 * This supports tracking overpayments (when a tenant pays more than outstanding balance).
 * Credits can be applied to future rent cycles instead of being lost.
 *
 * Use cases:
 * - Tenant pays more than required (manual payment, rounded up, etc.)
 * - Credit is tracked and applied to next renewal invoice
 * - Prevents loss of overpayment amounts
 */
export class AddCreditBalanceColumns1773700000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add credit_balance to rents table (stores int values)
    await queryRunner.query(`
      ALTER TABLE "rents"
      ADD COLUMN "credit_balance" INT DEFAULT 0
    `);

    // Add credit_balance to offer_letters table (stores decimal values)
    await queryRunner.query(`
      ALTER TABLE "offer_letters"
      ADD COLUMN "credit_balance" DECIMAL(12,2) DEFAULT 0
    `);

    // Add credit_balance to invoices table (stores decimal values)
    await queryRunner.query(`
      ALTER TABLE "invoices"
      ADD COLUMN "credit_balance" DECIMAL(15,2) DEFAULT 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "invoices"
      DROP COLUMN "credit_balance"
    `);

    await queryRunner.query(`
      ALTER TABLE "offer_letters"
      DROP COLUMN "credit_balance"
    `);

    await queryRunner.query(`
      ALTER TABLE "rents"
      DROP COLUMN "credit_balance"
    `);
  }
}
