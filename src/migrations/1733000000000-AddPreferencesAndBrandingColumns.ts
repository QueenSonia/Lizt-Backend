import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPreferencesAndBrandingColumns1733000000000
  implements MigrationInterface
{
  name = 'AddPreferencesAndBrandingColumns1733000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add preferences column to users table
    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD COLUMN IF NOT EXISTS "preferences" jsonb
    `);

    // Add branding column to users table
    await queryRunner.query(`
      ALTER TABLE "users" 
      ADD COLUMN IF NOT EXISTS "branding" jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the columns if rolling back
    await queryRunner.query(`
      ALTER TABLE "users" 
      DROP COLUMN IF EXISTS "preferences"
    `);

    await queryRunner.query(`
      ALTER TABLE "users" 
      DROP COLUMN IF EXISTS "branding"
    `);
  }
}
