import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Add payment_history jsonb column to renewal_invoices.
 *
 * Each entry is one Paystack-confirmed payment against the invoice:
 *   { reference, amount, paid_at, channel? }
 *
 * Drives partial-payment support — `amount_paid` becomes the running sum
 * of this array, and idempotency on each top-up is checked by looking up
 * the reference here (replaces the old "early-return if status === PAID"
 * guard, which was correct only for single-shot payments).
 */
export class AddPaymentHistoryToRenewalInvoices1781000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
      ADD COLUMN "payment_history" JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
      DROP COLUMN "payment_history"
    `);
  }
}
