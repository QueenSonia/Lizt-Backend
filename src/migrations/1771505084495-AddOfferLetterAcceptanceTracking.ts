import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOfferLetterAcceptanceTracking1771505084495
  implements MigrationInterface
{
  name = 'AddOfferLetterAcceptanceTracking1771505084495';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add columns to track acceptance details
    await queryRunner.query(`
      ALTER TABLE "offer_letters" 
      ADD COLUMN "accepted_at" TIMESTAMP,
      ADD COLUMN "accepted_by_phone" VARCHAR(20),
      ADD COLUMN "acceptance_otp" VARCHAR(10)
    `);

    // Add comment to explain the columns
    await queryRunner.query(`
      COMMENT ON COLUMN "offer_letters"."accepted_at" IS 'Timestamp when the offer was accepted via OTP verification'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "offer_letters"."accepted_by_phone" IS 'Phone number used to accept the offer'
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "offer_letters"."acceptance_otp" IS 'OTP code used to accept the offer (for audit trail)'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the columns
    await queryRunner.query(`
      ALTER TABLE "offer_letters" 
      DROP COLUMN "acceptance_otp",
      DROP COLUMN "accepted_by_phone",
      DROP COLUMN "accepted_at"
    `);
  }
}
