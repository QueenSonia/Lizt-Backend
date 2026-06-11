import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ad-hoc invoices gain partial-payment + plan-coverage support:
 *  - amount_paid: how much has been collected (drives the PARTIAL status).
 *  - covered_by_plan_id: set when a payment plan owns this invoice's debt; its
 *    public pay link is then locked. ON DELETE SET NULL so a hard-deleted plan
 *    re-opens the link rather than orphaning the invoice.
 *
 * Data backfill: already-PAID invoices are fully paid, so amount_paid =
 * total_amount, keeping read paths (and the breakdown line-item cap) exact.
 */
export class AddAmountPaidAndCoverageToAdHocInvoices1903000000002
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "ad_hoc_invoices"
        ADD COLUMN IF NOT EXISTS "amount_paid" NUMERIC(12,2) NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "ad_hoc_invoices"
        ADD COLUMN IF NOT EXISTS "covered_by_plan_id" uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "ad_hoc_invoices"
        ADD CONSTRAINT "fk_ad_hoc_invoices_covered_by_plan"
        FOREIGN KEY ("covered_by_plan_id")
        REFERENCES "payment_plans"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ad_hoc_invoices_covered_by_plan"
        ON "ad_hoc_invoices"("covered_by_plan_id")
        WHERE "covered_by_plan_id" IS NOT NULL
    `);

    // Backfill historical paid invoices so amount_paid reflects reality.
    await queryRunner.query(`
      UPDATE "ad_hoc_invoices"
        SET "amount_paid" = "total_amount"
        WHERE "status" = 'paid'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_ad_hoc_invoices_covered_by_plan"`,
    );
    await queryRunner.query(`
      ALTER TABLE "ad_hoc_invoices"
        DROP CONSTRAINT IF EXISTS "fk_ad_hoc_invoices_covered_by_plan"
    `);
    await queryRunner.query(
      `ALTER TABLE "ad_hoc_invoices" DROP COLUMN IF EXISTS "covered_by_plan_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ad_hoc_invoices" DROP COLUMN IF EXISTS "amount_paid"`,
    );
  }
}
