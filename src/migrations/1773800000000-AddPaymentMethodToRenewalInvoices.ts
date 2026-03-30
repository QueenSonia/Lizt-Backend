import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentMethodToRenewalInvoices1773800000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
      ADD COLUMN "payment_method" VARCHAR(50) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
      DROP COLUMN "payment_method"
    `);
  }
}
