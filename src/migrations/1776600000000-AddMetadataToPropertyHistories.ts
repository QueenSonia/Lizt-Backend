import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a JSONB `metadata` column to `property_histories` so event types like
 * `rent_period_amended` can stash structured audit data (before/after
 * snapshots, acknowledged issue ids) alongside the human-readable
 * `event_description`.
 */
export class AddMetadataToPropertyHistories1776600000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "property_histories"
        ADD COLUMN IF NOT EXISTS "metadata" JSONB
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "property_histories"
        DROP COLUMN IF EXISTS "metadata"
    `);
  }
}
