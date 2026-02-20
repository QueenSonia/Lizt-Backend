import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration: Rename KYC property_id to initial_property_id
 *
 * Purpose: Enable multi-property offers by treating the KYC application's property
 * as historical context only. The offer_letter.property_id becomes the single source
 * of truth for which property a tenant will be attached to.
 *
 * Strategy: Zero-downtime migration
 * 1. Add new column initial_property_id
 * 2. Copy data from property_id
 * 3. Add constraints and indexes
 * 4. Keep property_id for backward compatibility (remove in future migration)
 */
export class RenameKycPropertyToInitial1771600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Add new column (nullable initially)
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      ADD COLUMN "initial_property_id" uuid;
    `);

    // Step 2: Copy existing data from property_id to initial_property_id
    await queryRunner.query(`
      UPDATE "kyc_applications" 
      SET "initial_property_id" = "property_id";
    `);

    // Step 3: Add NOT NULL constraint after data is copied
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      ALTER COLUMN "initial_property_id" SET NOT NULL;
    `);

    // Step 4: Add foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      ADD CONSTRAINT "FK_kyc_applications_initial_property" 
      FOREIGN KEY ("initial_property_id") 
      REFERENCES "properties"("id") 
      ON DELETE CASCADE;
    `);

    // Step 5: Add index for performance (queries filtering by initial property)
    await queryRunner.query(`
      CREATE INDEX "IDX_kyc_applications_initial_property_id" 
      ON "kyc_applications" ("initial_property_id");
    `);

    console.log('✅ Migration completed: initial_property_id column added');
    console.log('✅ Data copied from property_id to initial_property_id');
    console.log('✅ Constraints and indexes created');
    console.log('ℹ️  property_id column kept for backward compatibility');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback: Remove everything we added
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_kyc_applications_initial_property_id";
    `);

    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      DROP CONSTRAINT IF EXISTS "FK_kyc_applications_initial_property";
    `);

    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      DROP COLUMN IF EXISTS "initial_property_id";
    `);

    console.log('✅ Rollback completed: initial_property_id column removed');
  }
}
