import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The tenant-facing payment-plan-request form no longer collects a discrete
 * installment amount — the tenant describes amount + cadence together in the
 * free-text `preferred_schedule`. The column stays on the table so the
 * landlord can still fill it in during approval, but submissions from the
 * token endpoint now write NULL.
 */
export class MakePaymentPlanRequestInstallmentAmountNullable1776300000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_plan_requests" ALTER COLUMN "installment_amount" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "payment_plan_requests" ALTER COLUMN "installment_amount" SET NOT NULL`,
    );
  }
}
