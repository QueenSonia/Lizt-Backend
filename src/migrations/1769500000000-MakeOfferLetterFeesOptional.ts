import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeOfferLetterFeesOptional1769500000000
  implements MigrationInterface
{
  name = 'MakeOfferLetterFeesOptional1769500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Make caution_deposit nullable
    await queryRunner.query(`
      ALTER TABLE "offer_letters" 
      ALTER COLUMN "caution_deposit" DROP NOT NULL;
    `);

    // Make legal_fee nullable
    await queryRunner.query(`
      ALTER TABLE "offer_letters" 
      ALTER COLUMN "legal_fee" DROP NOT NULL;
    `);

    // First make agency_fee nullable
    await queryRunner.query(`
      ALTER TABLE "offer_letters" 
      ALTER COLUMN "agency_fee" DROP NOT NULL;
    `);

    // Then change agency_fee from varchar to decimal
    await queryRunner.query(`
      ALTER TABLE "offer_letters" 
      ALTER COLUMN "agency_fee" TYPE decimal(12,2) 
      USING CASE 
        WHEN agency_fee IS NOT NULL AND agency_fee ~ '^[0-9]+\.?[0-9]*$' 
        THEN agency_fee::decimal(12,2)
        ELSE NULL
      END;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Revert agency_fee to varchar
    await queryRunner.query(`
      ALTER TABLE "offer_letters" 
      ALTER COLUMN "agency_fee" TYPE varchar(255) 
      USING COALESCE(agency_fee::text, '0');
    `);

    await queryRunner.query(`
      ALTER TABLE "offer_letters" 
      ALTER COLUMN "agency_fee" SET NOT NULL;
    `);

    // Set default values for null fields before making them NOT NULL
    await queryRunner.query(`
      UPDATE "offer_letters" 
      SET "legal_fee" = 0 
      WHERE "legal_fee" IS NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "offer_letters" 
      ALTER COLUMN "legal_fee" SET NOT NULL;
    `);

    await queryRunner.query(`
      UPDATE "offer_letters" 
      SET "caution_deposit" = 0 
      WHERE "caution_deposit" IS NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "offer_letters" 
      ALTER COLUMN "caution_deposit" SET NOT NULL;
    `);
  }
}
