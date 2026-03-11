import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceiptFieldsToRenewalInvoices1773100000000
  implements MigrationInterface
{
  name = 'AddReceiptFieldsToRenewalInvoices1773100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "renewal_invoices" ADD "receipt_token" varchar(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "renewal_invoices" ADD "receipt_number" varchar(50)`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_renewal_invoices_receipt_token" ON "renewal_invoices" ("receipt_token")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_renewal_invoices_receipt_token"`);
    await queryRunner.query(
      `ALTER TABLE "renewal_invoices" DROP COLUMN "receipt_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "renewal_invoices" DROP COLUMN "receipt_token"`,
    );
  }
}
