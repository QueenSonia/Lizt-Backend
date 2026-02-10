import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add partial indexes for soft-delete patterns
 * These indexes only include non-deleted rows, making them smaller and faster
 */
export class AddSoftDeleteIndexes1771200000000 implements MigrationInterface {
  name = 'AddSoftDeleteIndexes1771200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Partial index for properties - owner + status where not deleted
    // This is the most impactful index for the slow queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_properties_owner_status_active" 
      ON "properties" ("owner_id", "property_status") 
      WHERE "deleted_at" IS NULL
    `);

    // Partial index for kyc_applications by kyc_link_id (for getAllApplications JOIN)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_kyc_applications_kyc_link_active" 
      ON "kyc_applications" ("kyc_link_id") 
      WHERE "deleted_at" IS NULL
    `);

    // Composite index for kyc_links by landlord_id (for the property.owner_id filter)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_kyc_links_landlord_active" 
      ON "kyc_links" ("landlord_id") 
      WHERE "deleted_at" IS NULL
    `);

    // Index for rents with active status (used in getAllProperties)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rents_property_active_status" 
      ON "rents" ("property_id", "rent_status") 
      WHERE "deleted_at" IS NULL
    `);

    // Index for property_tenants with active status
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_property_tenants_property_active" 
      ON "property_tenants" ("property_id", "status") 
      WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_property_tenants_property_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_rents_property_active_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_kyc_links_landlord_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_kyc_applications_kyc_link_active"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_properties_owner_status_active"`,
    );
  }
}
