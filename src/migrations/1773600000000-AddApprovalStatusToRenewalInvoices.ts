import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApprovalStatusToRenewalInvoices1773600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
      ADD COLUMN "approval_status" VARCHAR(20) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
      DROP COLUMN "approval_status"
    `);
  }
}
