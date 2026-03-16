import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop the lease_agreement_end_date column from rents table.
 *
 * This column was a legacy reference date that duplicated expiry_date.
 * The rent system now uses only:
 *   - rent_start_date: when the tenancy started
 *   - expiry_date: when the current rent payment cycle ends (auto-calculated from start + frequency)
 *   - payment_frequency: how often rent is paid
 *
 * Before dropping, any rows where expiry_date is NULL but lease_agreement_end_date
 * has a value will have expiry_date backfilled from lease_agreement_end_date.
 * This handles old records created through legacy attachment paths.
 */
export class DropLeaseAgreementEndDate1773300000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Backfill: copy lease_agreement_end_date into expiry_date where expiry_date is missing
    await queryRunner.query(`
      UPDATE "rents"
      SET "expiry_date" = "lease_agreement_end_date"
      WHERE "expiry_date" IS NULL
        AND "lease_agreement_end_date" IS NOT NULL
    `);

    // Drop the column
    await queryRunner.query(`
      ALTER TABLE "rents" DROP COLUMN "lease_agreement_end_date"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add the column as nullable
    await queryRunner.query(`
      ALTER TABLE "rents"
      ADD COLUMN "lease_agreement_end_date" TIMESTAMP NULL
    `);

    // Copy expiry_date back for reference
    await queryRunner.query(`
      UPDATE "rents"
      SET "lease_agreement_end_date" = "expiry_date"
      WHERE "expiry_date" IS NOT NULL
    `);
  }
}
