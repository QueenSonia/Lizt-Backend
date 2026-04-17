import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Billing v2 — adds recurring flags + legal/agency/other fees to `rents`.
 *
 * Additive only. Defaults preserve existing behavior: service charge is
 * considered recurring (matches prior implicit assumption); caution, legal,
 * and agency default to one-time; other_fees starts empty.
 */
export class AddRecurringFlagsToRents1775000000001
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rents"
        ADD COLUMN "service_charge_recurring"  BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN "security_deposit_recurring" BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN "legal_fee"                 NUMERIC(12,2),
        ADD COLUMN "legal_fee_recurring"       BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN "agency_fee"                NUMERIC(12,2),
        ADD COLUMN "agency_fee_recurring"      BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN "other_fees"                JSONB   NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rents"
        DROP COLUMN "other_fees",
        DROP COLUMN "agency_fee_recurring",
        DROP COLUMN "agency_fee",
        DROP COLUMN "legal_fee_recurring",
        DROP COLUMN "legal_fee",
        DROP COLUMN "security_deposit_recurring",
        DROP COLUMN "service_charge_recurring"
    `);
  }
}
