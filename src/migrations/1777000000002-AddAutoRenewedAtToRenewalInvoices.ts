import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Auto-renewal stamp — when a rent's expiry passes and the tenant
 * hasn't accepted the renewal letter, processOverdueRents flips the
 * row from 'sent' to 'accepted' and sets auto_renewed_at. The tenant
 * page renders an AUTO-RENEWED stamp (distinct from the OTP-bound
 * ACCEPTED stamp) when this column is non-null and acceptance_otp
 * is null.
 */
export class AddAutoRenewedAtToRenewalInvoices1777000000002
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        ADD COLUMN IF NOT EXISTS "auto_renewed_at" TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        DROP COLUMN IF EXISTS "auto_renewed_at"
    `);
  }
}
