import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Billing v2 — extend renewal_invoices with the columns that used to be
 * silently zeroed at cron time (caution_deposit, agency_fee, other_fees)
 * plus a full fee_breakdown JSONB snapshot that matches Fee[] from
 * common/billing/fees.ts.
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        DROP COLUMN "fee_breakdown",
        DROP COLUMN "other_fees",
        DROP COLUMN "agency_fee",
        DROP COLUMN "caution_deposit"
    `);
  }
}
