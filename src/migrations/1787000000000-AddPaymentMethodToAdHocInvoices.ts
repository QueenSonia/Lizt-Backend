import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentMethodToAdHocInvoices1787000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ad_hoc_invoices"
      ADD COLUMN "payment_method" VARCHAR(50) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ad_hoc_invoices"
      DROP COLUMN "payment_method"
    `);
  }
}
