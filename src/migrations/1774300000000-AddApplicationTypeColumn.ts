import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddApplicationTypeColumn1774300000000
  implements MigrationInterface
{
  name = 'AddApplicationTypeColumn1774300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add application_type column to kyc_applications table
    await queryRunner.query(`
      DO $$ BEGIN
        -- Add application_type column if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'application_type') THEN
          -- Create the enum type first
          DO $enum$ BEGIN
            CREATE TYPE "kyc_applications_application_type_enum" AS ENUM('new_tenant', 'property_addition');
          EXCEPTION
            WHEN duplicate_object THEN null;
          END $enum$;
          
          -- Add column with enum type and default
          ALTER TABLE "kyc_applications" 
          ADD COLUMN "application_type" "kyc_applications_application_type_enum" DEFAULT 'new_tenant';
          
          -- Set NOT NULL constraint
          ALTER TABLE "kyc_applications" 
          ALTER COLUMN "application_type" SET NOT NULL;
        END IF;
      END $$;
    `);

    console.log('✅ Added application_type column to kyc_applications table');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove application_type column
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" DROP COLUMN IF EXISTS "application_type";
      DROP TYPE IF EXISTS "kyc_applications_application_type_enum";
    `);
  }
}
