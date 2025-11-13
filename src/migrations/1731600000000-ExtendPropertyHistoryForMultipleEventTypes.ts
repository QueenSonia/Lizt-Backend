import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendPropertyHistoryForMultipleEventTypes1731600000000
  implements MigrationInterface
{
  name = 'ExtendPropertyHistoryForMultipleEventTypes1731600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add new columns for event type support
    await queryRunner.query(`
      ALTER TABLE "property_histories" 
      ADD COLUMN IF NOT EXISTS "event_type" varchar NOT NULL DEFAULT 'tenancy_record',
      ADD COLUMN IF NOT EXISTS "event_description" text,
      ADD COLUMN IF NOT EXISTS "related_entity_id" uuid,
      ADD COLUMN IF NOT EXISTS "related_entity_type" varchar
    `);

    // Make tenancy-specific fields nullable
    await queryRunner.query(`
      ALTER TABLE "property_histories" 
      ALTER COLUMN "move_in_date" DROP NOT NULL,
      ALTER COLUMN "monthly_rent" DROP NOT NULL
    `);

    // Create index on event_type for efficient filtering
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_property_histories_event_type" 
      ON "property_histories" ("event_type")
    `);

    // Create index on related_entity_id for efficient lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_property_histories_related_entity" 
      ON "property_histories" ("related_entity_id", "related_entity_type")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_property_histories_related_entity"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "idx_property_histories_event_type"
    `);

    // Restore NOT NULL constraints (this may fail if there are null values)
    await queryRunner.query(`
      ALTER TABLE "property_histories" 
      ALTER COLUMN "move_in_date" SET NOT NULL,
      ALTER COLUMN "monthly_rent" SET NOT NULL
    `);

    // Remove the new columns
    await queryRunner.query(`
      ALTER TABLE "property_histories" 
      DROP COLUMN IF EXISTS "event_type",
      DROP COLUMN IF EXISTS "event_description",
      DROP COLUMN IF EXISTS "related_entity_id",
      DROP COLUMN IF EXISTS "related_entity_type"
    `);
  }
}
