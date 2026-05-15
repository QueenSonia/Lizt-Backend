import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Inverse of 1789000000000-AddFacilityManagerIdToProperties. Facility
 * managers are now assigned per maintenance request (service_requests.assigned_to)
 * rather than per property. The column, its FK to team_member, and the index
 * are all dropped. Existing service_requests.assigned_to values are preserved
 * unchanged — no data backfill.
 */
export class DropFacilityManagerIdFromProperties1794000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_properties_facility_manager_id
    `);
    await queryRunner.query(`
      ALTER TABLE properties
        DROP CONSTRAINT IF EXISTS fk_properties_facility_manager
    `);
    await queryRunner.query(`
      ALTER TABLE properties
        DROP COLUMN IF EXISTS facility_manager_id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE properties
        ADD COLUMN IF NOT EXISTS facility_manager_id uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE properties
        ADD CONSTRAINT fk_properties_facility_manager
        FOREIGN KEY (facility_manager_id)
        REFERENCES team_member(id)
        ON DELETE SET NULL
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_properties_facility_manager_id
        ON properties (facility_manager_id)
    `);
  }
}
