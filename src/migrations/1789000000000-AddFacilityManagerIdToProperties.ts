import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `facility_manager_id` to `properties` so a property can be assigned
 * to at most one facility manager. The FK targets `team_member.id` (per-team
 * grain), so an FM removed from the landlord's team auto-unassigns their
 * properties via ON DELETE SET NULL.
 */
export class AddFacilityManagerIdToProperties1789000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
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

  public async down(queryRunner: QueryRunner): Promise<void> {
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
}
