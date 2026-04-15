import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Billing v2 — adds recurring flags + other_fees to `offer_letters`.
 *
 * Defaults mirror the rents migration so existing offer letters keep their
 * current semantics (service charge recurring, caution/legal/agency one-time).
 */
export class AddRecurringFlagsToOfferLetters1775000000002
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "offer_letters"
        ADD COLUMN "service_charge_recurring"  BOOLEAN NOT NULL DEFAULT TRUE,
        ADD COLUMN "caution_deposit_recurring" BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN "legal_fee_recurring"       BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN "agency_fee_recurring"      BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN "other_fees"                JSONB   NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "offer_letters"
        DROP COLUMN "other_fees",
        DROP COLUMN "agency_fee_recurring",
        DROP COLUMN "legal_fee_recurring",
        DROP COLUMN "caution_deposit_recurring",
        DROP COLUMN "service_charge_recurring"
    `);
  }
}
