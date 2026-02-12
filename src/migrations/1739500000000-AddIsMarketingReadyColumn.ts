import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIsMarketingReadyColumn1739500000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add the new boolean column with default false
    await queryRunner.query(`
      ALTER TABLE "properties"
      ADD COLUMN IF NOT EXISTS "is_marketing_ready" boolean NOT NULL DEFAULT false
    `);

    // Backfill: set is_marketing_ready = true for properties currently in ready_for_marketing status
    await queryRunner.query(`
      UPDATE "properties"
      SET "is_marketing_ready" = true
      WHERE "property_status" = 'ready_for_marketing'
    `);

    // Transition ready_for_marketing properties back to vacant
    // (the boolean now carries the marketing flag independently)
    await queryRunner.query(`
      UPDATE "properties"
      SET "property_status" = 'vacant'
      WHERE "property_status" = 'ready_for_marketing'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Restore ready_for_marketing status for properties that had the flag
    await queryRunner.query(`
      UPDATE "properties"
      SET "property_status" = 'ready_for_marketing'
      WHERE "is_marketing_ready" = true
        AND "property_status" = 'vacant'
    `);

    // Drop the column
    await queryRunner.query(`
      ALTER TABLE "properties"
      DROP COLUMN IF EXISTS "is_marketing_ready"
    `);
  }
}
