import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add outstanding_balance, amount_paid, payment_option, and token_type
 * columns to the renewal_invoices table.
 *
 * These support the flexible payment flow where tenants with an outstanding
 * balance can choose what to pay (current charges, outstanding balance,
 * full payment, or a custom amount).
 */
export class AddOutstandingBalanceToRenewalInvoices1773500000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
      ADD COLUMN "outstanding_balance" DECIMAL(10,2) DEFAULT 0,
      ADD COLUMN "amount_paid" DECIMAL(10,2) NULL,
      ADD COLUMN "payment_option" VARCHAR(30) NULL,
      ADD COLUMN "token_type" VARCHAR(20) DEFAULT 'landlord'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
      DROP COLUMN "token_type",
      DROP COLUMN "payment_option",
      DROP COLUMN "amount_paid",
      DROP COLUMN "outstanding_balance"
    `);
  }
}
