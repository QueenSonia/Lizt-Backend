import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Billing v2 — extend renewal_invoices with the columns that used to be
 * silently zeroed at cron time (caution_deposit, agency_fee, other_fees)
 * plus a full fee_breakdown JSONB snapshot that matches Fee[] from
 * common/billing/fees.ts.
 *
 * Also adds a unique constraint on (property_tenant_id, start_date) so the
 * auto-renewal cron is idempotent per period.
 */
export class AddFeeBreakdownToRenewalInvoices1775000000005
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        ADD COLUMN "caution_deposit" NUMERIC(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN "agency_fee"      NUMERIC(10,2) NOT NULL DEFAULT 0,
        ADD COLUMN "other_fees"      JSONB         NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN "fee_breakdown"   JSONB         NOT NULL DEFAULT '[]'::jsonb
    `);

    // Idempotency guard: one renewal invoice per (tenant, period start).
    // Partial index so deleted rows don't collide.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_renewal_invoices_tenant_period"
        ON "renewal_invoices" ("property_tenant_id", "start_date")
        WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_renewal_invoices_tenant_period"`);
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        DROP COLUMN "fee_breakdown",
        DROP COLUMN "other_fees",
        DROP COLUMN "agency_fee",
        DROP COLUMN "caution_deposit"
    `);
  }
}
