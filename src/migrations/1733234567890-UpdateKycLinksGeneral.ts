import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateKycLinksGeneral1733234567890 implements MigrationInterface {
  name = 'UpdateKycLinksGeneral1733234567890';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Step 1: Handle existing duplicate active KYC links
    // Keep only the most recent active link per landlord, deactivate the rest
    await queryRunner.query(`
      UPDATE "kyc_links" 
      SET "is_active" = false 
      WHERE "id" NOT IN (
        SELECT DISTINCT ON ("landlord_id") "id"
        FROM "kyc_links" 
        WHERE "is_active" = true
        ORDER BY "landlord_id", "created_at" DESC
      ) AND "is_active" = true
    `);

    // Step 2: Remove the property_id column from kyc_links table
    // This makes KYC links general to landlords instead of property-specific
    await queryRunner.query(`
      ALTER TABLE "kyc_links" 
      DROP CONSTRAINT IF EXISTS "FK_kyc_links_property_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "kyc_links" 
      DROP COLUMN IF EXISTS "property_id"
    `);

    // Step 3: Add unique constraint on landlord_id to ensure one active link per landlord
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_kyc_links_landlord_active" 
      ON "kyc_links" ("landlord_id") 
      WHERE "is_active" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the unique constraint
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_kyc_links_landlord_active"
    `);

    // Add back the property_id column
    await queryRunner.query(`
      ALTER TABLE "kyc_links" 
      ADD COLUMN "property_id" uuid
    `);

    // Add back the foreign key constraint
    await queryRunner.query(`
      ALTER TABLE "kyc_links" 
      ADD CONSTRAINT "FK_kyc_links_property_id" 
      FOREIGN KEY ("property_id") REFERENCES "properties"("id") 
      ON DELETE CASCADE
    `);
  }
}
