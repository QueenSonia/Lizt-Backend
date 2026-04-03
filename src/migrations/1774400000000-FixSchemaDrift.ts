import { MigrationInterface, QueryRunner } from 'typeorm';

export class FixSchemaDrift1774400000000 implements MigrationInterface {
  name = 'FixSchemaDrift1774400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('🔧 Fixing schema drift in kyc_applications table...');

    // Fix column renames that may not have been applied properly
    await queryRunner.query(`
      DO $$ BEGIN
        -- Fix work_address column
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'employer_address') 
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'work_address') THEN
          ALTER TABLE "kyc_applications" RENAME COLUMN "employer_address" TO "work_address";
        END IF;

        -- Fix work_phone_number column
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'employer_phone_number') 
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'work_phone_number') THEN
          ALTER TABLE "kyc_applications" RENAME COLUMN "employer_phone_number" TO "work_phone_number";
        END IF;

        -- Fix next_of_kin columns
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference1_name') 
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'next_of_kin_full_name') THEN
          ALTER TABLE "kyc_applications" RENAME COLUMN "reference1_name" TO "next_of_kin_full_name";
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference1_address') 
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'next_of_kin_address') THEN
          ALTER TABLE "kyc_applications" RENAME COLUMN "reference1_address" TO "next_of_kin_address";
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference1_relationship') 
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'next_of_kin_relationship') THEN
          ALTER TABLE "kyc_applications" RENAME COLUMN "reference1_relationship" TO "next_of_kin_relationship";
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference1_phone_number') 
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'next_of_kin_phone_number') THEN
          ALTER TABLE "kyc_applications" RENAME COLUMN "reference1_phone_number" TO "next_of_kin_phone_number";
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference1_email') 
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'next_of_kin_email') THEN
          ALTER TABLE "kyc_applications" RENAME COLUMN "reference1_email" TO "next_of_kin_email";
        END IF;

        -- Fix referral_agent columns
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference2_name') 
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'referral_agent_full_name') THEN
          ALTER TABLE "kyc_applications" RENAME COLUMN "reference2_name" TO "referral_agent_full_name";
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference2_phone_number') 
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'referral_agent_phone_number') THEN
          ALTER TABLE "kyc_applications" RENAME COLUMN "reference2_phone_number" TO "referral_agent_phone_number";
        END IF;

        -- Drop unused reference2 columns
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference2_address') THEN
          ALTER TABLE "kyc_applications" DROP COLUMN "reference2_address";
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'reference2_relationship') THEN
          ALTER TABLE "kyc_applications" DROP COLUMN "reference2_relationship";
        END IF;

        -- Fix parking_needs column
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'number_of_cars_owned') 
        AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'parking_needs') THEN
          ALTER TABLE "kyc_applications" RENAME COLUMN "number_of_cars_owned" TO "parking_needs";
        END IF;

        -- Add missing columns
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'pending_kyc_id') THEN
          ALTER TABLE "kyc_applications" ADD COLUMN "pending_kyc_id" character varying;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'available_property_ids') THEN
          ALTER TABLE "kyc_applications" ADD COLUMN "available_property_ids" character varying;
        END IF;

        -- Add initial_property_id column if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'initial_property_id') THEN
          ALTER TABLE "kyc_applications" ADD COLUMN "initial_property_id" uuid;
          -- Copy data from property_id to initial_property_id
          UPDATE "kyc_applications" SET "initial_property_id" = "property_id";
          -- Set NOT NULL constraint
          ALTER TABLE "kyc_applications" ALTER COLUMN "initial_property_id" SET NOT NULL;
        END IF;

        -- Add tracking fields if they don't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'form_opened_at') THEN
          ALTER TABLE "kyc_applications" ADD COLUMN "form_opened_at" timestamp;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'form_opened_ip') THEN
          ALTER TABLE "kyc_applications" ADD COLUMN "form_opened_ip" character varying;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'decision_made_at') THEN
          ALTER TABLE "kyc_applications" ADD COLUMN "decision_made_at" timestamp;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'decision_made_ip') THEN
          ALTER TABLE "kyc_applications" ADD COLUMN "decision_made_ip" character varying;
        END IF;

        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'kyc_applications' AND column_name = 'user_agent') THEN
          ALTER TABLE "kyc_applications" ADD COLUMN "user_agent" character varying(512);
        END IF;
      END $$;
    `);

    console.log('✅ Schema drift fixed for kyc_applications table');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback is complex, keeping it simple
    console.log('⚠️  Rollback not implemented for schema drift fix');
  }
}
