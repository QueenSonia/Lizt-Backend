import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Coverage + FIFO allocation tables for wallet-backed (Outstanding Balance /
 * ad-hoc) payment plans.
 *
 * - payment_plan_sources: the frozen snapshot of charge-sources a plan covers,
 *   ordered by due_seq (FIFO). covered_amount is the amount at creation.
 * - payment_plan_allocations: how much of each installment was applied to each
 *   source. Per-source residual is DERIVED (covered_amount − Σ allocations over
 *   PAID installments); there is NO stored residual column by design.
 *
 * source_ad_hoc_invoice_id is RESTRICT (an allocated source must not vanish);
 * ad-hoc cancel sets status, it never hard-deletes the row, so this never fires.
 */
export class CreatePaymentPlanTables1903000000001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "payment_plan_sources" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "plan_id" uuid NOT NULL,
        "source_kind" VARCHAR(20) NOT NULL,
        "source_ad_hoc_invoice_id" uuid,
        "arrears_bucket_key" VARCHAR(64),
        "covered_amount" NUMERIC(12,2) NOT NULL,
        "due_seq" INTEGER NOT NULL,
        CONSTRAINT "fk_pps_plan"
          FOREIGN KEY ("plan_id")
          REFERENCES "payment_plans"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_pps_ad_hoc_invoice"
          FOREIGN KEY ("source_ad_hoc_invoice_id")
          REFERENCES "ad_hoc_invoices"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_pps_plan_id" ON "payment_plan_sources"("plan_id");
      CREATE INDEX "idx_pps_ad_hoc_invoice_id"
        ON "payment_plan_sources"("source_ad_hoc_invoice_id");
    `);

    await queryRunner.query(`
      CREATE TABLE "payment_plan_allocations" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP,
        "plan_id" uuid NOT NULL,
        "installment_id" uuid NOT NULL,
        "source_id" uuid NOT NULL,
        "amount" NUMERIC(12,2) NOT NULL,
        CONSTRAINT "fk_ppa_plan"
          FOREIGN KEY ("plan_id")
          REFERENCES "payment_plans"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_ppa_installment"
          FOREIGN KEY ("installment_id")
          REFERENCES "payment_plan_installments"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_ppa_source"
          FOREIGN KEY ("source_id")
          REFERENCES "payment_plan_sources"("id") ON DELETE CASCADE,
        CONSTRAINT "uq_ppa_installment_source"
          UNIQUE ("installment_id", "source_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_ppa_plan_id" ON "payment_plan_allocations"("plan_id");
      CREATE INDEX "idx_ppa_installment_id"
        ON "payment_plan_allocations"("installment_id");
      CREATE INDEX "idx_ppa_source_id"
        ON "payment_plan_allocations"("source_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "payment_plan_allocations"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "payment_plan_sources"`);
  }
}
