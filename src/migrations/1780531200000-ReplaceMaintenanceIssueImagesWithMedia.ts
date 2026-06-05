import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Maintenance-request attachments overhaul.
 *
 * Replaces the legacy `issue_images text[]` (image URLs only) with a unified
 * `issue_media jsonb` column holding `{ type: 'image' | 'video'; url; attempt }`
 * objects, so photos and videos live together and each is tagged with the
 * report cycle (`attempt`) it was added in. Also adds `current_attempt`
 * (the live cycle counter, incremented on each REOPENED transition).
 *
 * `issue_images` carried no production data, so it is dropped outright with no
 * backfill.
 */
export class ReplaceMaintenanceIssueImagesWithMedia1780531200000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "maintenance_requests"
        ADD COLUMN IF NOT EXISTS "issue_media" JSONB,
        ADD COLUMN IF NOT EXISTS "current_attempt" INTEGER NOT NULL DEFAULT 1,
        DROP COLUMN IF EXISTS "issue_images"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "maintenance_requests"
        ADD COLUMN IF NOT EXISTS "issue_images" TEXT[],
        DROP COLUMN IF EXISTS "current_attempt",
        DROP COLUMN IF EXISTS "issue_media"
    `);
  }
}
