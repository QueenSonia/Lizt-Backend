import { MigrationInterface, QueryRunner } from 'typeorm';

export class MakeKycTenancyFieldsNullable1743567000000
  implements MigrationInterface
{
  name = 'MakeKycTenancyFieldsNullable1743567000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_applications"
        ALTER COLUMN "intended_use_of_property" DROP NOT NULL,
        ALTER COLUMN "number_of_occupants" DROP NOT NULL,
        ALTER COLUMN "proposed_rent_amount" DROP NOT NULL,
        ALTER COLUMN "rent_payment_frequency" DROP NOT NULL;
    `);

    // Add application_type column if it doesn't exist yet
    await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'kyc_applications'
          AND column_name = 'application_type'
        ) THEN
          ALTER TABLE "kyc_applications"
            ADD COLUMN "application_type" character varying NOT NULL DEFAULT 'new_tenant';
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_applications"
        ALTER COLUMN "intended_use_of_property" SET NOT NULL,
        ALTER COLUMN "number_of_occupants" SET NOT NULL,
        ALTER COLUMN "proposed_rent_amount" SET NOT NULL,
        ALTER COLUMN "rent_payment_frequency" SET NOT NULL;
    `);
  }
}
