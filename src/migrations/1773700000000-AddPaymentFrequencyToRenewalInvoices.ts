import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentFrequencyToRenewalInvoices1773700000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
      ADD COLUMN IF NOT EXISTS "payment_frequency" VARCHAR(50) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
      DROP COLUMN "payment_frequency"
    `);
  }
}
