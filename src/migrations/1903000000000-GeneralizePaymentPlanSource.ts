import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Generalize payment_plans from "renewal-invoice charge only" to a multi-source
 * model: renewal_invoice_fee (Type A) | outstanding_balance | ad_hoc_invoice
 * (Type B, wallet-backed). Adds source_type (backfilled from the existing
 * synthetic-OB discriminator) and a nullable ad_hoc_invoice_id FK.
 */
export class GeneralizePaymentPlanSource1903000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_plans"
        ADD COLUMN IF NOT EXISTS "source_type" VARCHAR(30) NOT NULL
          DEFAULT 'renewal_invoice_fee'
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_plans"
        ADD COLUMN IF NOT EXISTS "ad_hoc_invoice_id" uuid
    `);

    // Backfill: legacy synthetic Outstanding-Balance plans are wallet-backed.
    await queryRunner.query(`
      UPDATE "payment_plans"
        SET "source_type" = 'outstanding_balance'
        WHERE "charge_external_id" = 'outstanding_balance'
    `);

    await queryRunner.query(`
      ALTER TABLE "payment_plans"
        ADD CONSTRAINT "fk_payment_plans_ad_hoc_invoice"
        FOREIGN KEY ("ad_hoc_invoice_id")
        REFERENCES "ad_hoc_invoices"("id") ON DELETE SET NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_plans_source_type"
        ON "payment_plans"("source_type")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_payment_plans_ad_hoc_invoice_id"
        ON "payment_plans"("ad_hoc_invoice_id")
        WHERE "ad_hoc_invoice_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_payment_plans_ad_hoc_invoice_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_payment_plans_source_type"`,
    );
    await queryRunner.query(`
      ALTER TABLE "payment_plans"
        DROP CONSTRAINT IF EXISTS "fk_payment_plans_ad_hoc_invoice"
    `);
    await queryRunner.query(
      `ALTER TABLE "payment_plans" DROP COLUMN IF EXISTS "ad_hoc_invoice_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "payment_plans" DROP COLUMN IF EXISTS "source_type"`,
    );
  }
}
