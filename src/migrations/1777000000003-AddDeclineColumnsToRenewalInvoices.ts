import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Decline-side parity with `acceptance_otp` / `accepted_by_phone`. The
 * reject flow is now OTP-gated (matching accept), so the verified code
 * and the phone that received it are persisted for the audit stamp.
 * Live OTP challenges still live in Redis with TTL.
 */
export class AddDeclineColumnsToRenewalInvoices1777000000003
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        ADD COLUMN IF NOT EXISTS "declined_by_phone" VARCHAR(16) NULL,
        ADD COLUMN IF NOT EXISTS "decline_otp" VARCHAR(8) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        DROP COLUMN IF EXISTS "decline_otp",
        DROP COLUMN IF EXISTS "declined_by_phone"
    `);
  }
}
