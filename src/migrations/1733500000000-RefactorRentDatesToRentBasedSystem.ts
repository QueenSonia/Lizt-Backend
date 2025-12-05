import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Refactor Rent Dates to Rent-Based System
 *
 * This migration simplifies the rent tracking system by:
 * 1. Renaming lease_start_date to rent_start_date (clearer semantics)
 * 2. Making lease_end_date optional (lease_agreement_end_date) for reference only
 * 3. Keeping expiry_date as the primary tracking mechanism for next rent due
 *
 * EXISTING DATA IMPACT:
 * - All existing lease_start_date values are preserved as rent_start_date
 * - All existing lease_end_date values are preserved as lease_agreement_end_date (optional reference)
 * - All existing expiry_date values remain unchanged (next rent due date)
 * - No data loss occurs
 *
 * ROLLBACK SAFE: The down() method restores the original schema
 */
export class RefactorRentDatesToRentBasedSystem1733500000000
  implements MigrationInterface
{
  name = 'RefactorRentDatesToRentBasedSystem1733500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    console.log('Starting migration: Refactor Rent Dates to Rent-Based System');

    // Step 1: Add new rent_start_date column (will replace lease_start_date)
    console.log('Step 1: Adding rent_start_date column...');
    await queryRunner.query(`
      ALTER TABLE "rents" 
      ADD COLUMN IF NOT EXISTS "rent_start_date" timestamp
    `);

    // Step 2: Copy data from lease_start_date to rent_start_date
    console.log('Step 2: Copying lease_start_date data to rent_start_date...');
    await queryRunner.query(`
      UPDATE "rents" 
      SET "rent_start_date" = "lease_start_date"
      WHERE "lease_start_date" IS NOT NULL
    `);

    // Step 3: Make rent_start_date NOT NULL (since it's required)
    console.log('Step 3: Making rent_start_date NOT NULL...');
    await queryRunner.query(`
      ALTER TABLE "rents" 
      ALTER COLUMN "rent_start_date" SET NOT NULL
    `);

    // Step 4: Rename lease_end_date to lease_agreement_end_date (optional reference)
    console.log(
      'Step 4: Renaming lease_end_date to lease_agreement_end_date...',
    );
    await queryRunner.query(`
      ALTER TABLE "rents" 
      RENAME COLUMN "lease_end_date" TO "lease_agreement_end_date"
    `);

    // Step 5: Make lease_agreement_end_date nullable (it's now optional)
    console.log('Step 5: Making lease_agreement_end_date nullable...');
    await queryRunner.query(`
      ALTER TABLE "rents" 
      ALTER COLUMN "lease_agreement_end_date" DROP NOT NULL
    `);

    // Step 6: Drop the old lease_start_date column (data already copied)
    console.log('Step 6: Dropping old lease_start_date column...');
    await queryRunner.query(`
      ALTER TABLE "rents" 
      DROP COLUMN IF EXISTS "lease_start_date"
    `);

    // Step 7: Add comment to clarify the new schema
    await queryRunner.query(`
      COMMENT ON COLUMN "rents"."rent_start_date" IS 'Date when rent payments started for this tenancy';
      COMMENT ON COLUMN "rents"."lease_agreement_end_date" IS 'Optional reference date for lease agreement end (not enforced, for documentation only)';
      COMMENT ON COLUMN "rents"."expiry_date" IS 'Next rent payment due date (primary tracking mechanism)';
    `);

    console.log('Migration completed successfully!');
    console.log('Summary:');
    console.log('- lease_start_date → rent_start_date (required)');
    console.log('- lease_end_date → lease_agreement_end_date (optional)');
    console.log('- expiry_date remains unchanged (next rent due)');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    console.log(
      'Rolling back migration: Refactor Rent Dates to Rent-Based System',
    );

    // Step 1: Add back lease_start_date column
    console.log('Step 1: Adding back lease_start_date column...');
    await queryRunner.query(`
      ALTER TABLE "rents" 
      ADD COLUMN IF NOT EXISTS "lease_start_date" timestamp
    `);

    // Step 2: Copy data from rent_start_date back to lease_start_date
    console.log('Step 2: Restoring lease_start_date data...');
    await queryRunner.query(`
      UPDATE "rents" 
      SET "lease_start_date" = "rent_start_date"
      WHERE "rent_start_date" IS NOT NULL
    `);

    // Step 3: Make lease_start_date NOT NULL
    console.log('Step 3: Making lease_start_date NOT NULL...');
    await queryRunner.query(`
      ALTER TABLE "rents" 
      ALTER COLUMN "lease_start_date" SET NOT NULL
    `);

    // Step 4: Rename lease_agreement_end_date back to lease_end_date
    console.log(
      'Step 4: Renaming lease_agreement_end_date back to lease_end_date...',
    );
    await queryRunner.query(`
      ALTER TABLE "rents" 
      RENAME COLUMN "lease_agreement_end_date" TO "lease_end_date"
    `);

    // Step 5: Make lease_end_date NOT NULL again
    console.log('Step 5: Making lease_end_date NOT NULL...');
    await queryRunner.query(`
      ALTER TABLE "rents" 
      ALTER COLUMN "lease_end_date" SET NOT NULL
    `);

    // Step 6: Drop rent_start_date column
    console.log('Step 6: Dropping rent_start_date column...');
    await queryRunner.query(`
      ALTER TABLE "rents" 
      DROP COLUMN IF EXISTS "rent_start_date"
    `);

    // Step 7: Remove comments
    await queryRunner.query(`
      COMMENT ON COLUMN "rents"."lease_start_date" IS NULL;
      COMMENT ON COLUMN "rents"."lease_end_date" IS NULL;
      COMMENT ON COLUMN "rents"."expiry_date" IS NULL;
    `);

    console.log('Rollback completed successfully!');
  }
}
