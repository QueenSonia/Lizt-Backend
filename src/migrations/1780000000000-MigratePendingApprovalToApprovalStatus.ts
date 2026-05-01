import { MigrationInterface, QueryRunner } from 'typeorm';

export class MigratePendingApprovalToApprovalStatus1780000000000
  implements MigrationInterface
{
  name = 'MigratePendingApprovalToApprovalStatus1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "renewal_invoices"
      SET "payment_status" = 'unpaid',
          "approval_status" = 'pending'
      WHERE "payment_status" = 'pending_approval'
        AND "approval_status" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "renewal_invoices"
      SET "payment_status" = 'pending_approval',
          "approval_status" = NULL
      WHERE "payment_status" = 'unpaid'
        AND "approval_status" = 'pending'
    `);
  }
}
