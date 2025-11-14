import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMissingColumns1731585600000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add business_proof_url to kyc_applications if it doesn't exist
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'kyc_applications' 
          AND column_name = 'business_proof_url'
        ) THEN
          ALTER TABLE "kyc_applications" 
          ADD COLUMN "business_proof_url" varchar NULL;
        END IF;
      END $$;
    `);

    // Add deleted_at to kyc_feedback if it doesn't exist
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'kyc_feedback' 
          AND column_name = 'deleted_at'
        ) THEN
          ALTER TABLE "kyc_feedback" 
          ADD COLUMN "deleted_at" timestamp NULL;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove business_proof_url from kyc_applications
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      DROP COLUMN IF EXISTS "business_proof_url";
    `);

    // Remove deleted_at from kyc_feedback
    await queryRunner.query(`
      ALTER TABLE "kyc_feedback" 
      DROP COLUMN IF EXISTS "deleted_at";
    `);
  }
}
