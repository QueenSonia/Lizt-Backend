import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddKycApplicationFields1731350000000
  implements MigrationInterface
{
  name = 'AddKycApplicationFields1731350000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns to kyc_applications table
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      ADD COLUMN IF NOT EXISTS "religion" varchar,
      ADD COLUMN IF NOT EXISTS "reference1_email" varchar,
      ADD COLUMN IF NOT EXISTS "employer_phone_number" varchar,
      ADD COLUMN IF NOT EXISTS "length_of_employment" varchar,
      ADD COLUMN IF NOT EXISTS "business_duration" varchar,
      ADD COLUMN IF NOT EXISTS "intended_use_of_property" varchar,
      ADD COLUMN IF NOT EXISTS "number_of_occupants" varchar,
      ADD COLUMN IF NOT EXISTS "proposed_rent_amount" varchar,
      ADD COLUMN IF NOT EXISTS "rent_payment_frequency" varchar,
      ADD COLUMN IF NOT EXISTS "additional_notes" text,
      ADD COLUMN IF NOT EXISTS "passport_photo_url" varchar,
      ADD COLUMN IF NOT EXISTS "id_document_url" varchar,
      ADD COLUMN IF NOT EXISTS "employment_proof_url" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the columns if rolling back
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      DROP COLUMN IF EXISTS "religion",
      DROP COLUMN IF EXISTS "reference1_email",
      DROP COLUMN IF EXISTS "employer_phone_number",
      DROP COLUMN IF EXISTS "length_of_employment",
      DROP COLUMN IF EXISTS "business_duration",
      DROP COLUMN IF EXISTS "intended_use_of_property",
      DROP COLUMN IF EXISTS "number_of_occupants",
      DROP COLUMN IF EXISTS "proposed_rent_amount",
      DROP COLUMN IF EXISTS "rent_payment_frequency",
      DROP COLUMN IF EXISTS "additional_notes",
      DROP COLUMN IF EXISTS "passport_photo_url",
      DROP COLUMN IF EXISTS "id_document_url",
      DROP COLUMN IF EXISTS "employment_proof_url"
    `);
  }
}
