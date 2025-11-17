import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveLocalGovernmentAreaColumn1731870000000
  implements MigrationInterface
{
  name = 'RemoveLocalGovernmentAreaColumn1731870000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remove local_government_area column from kyc_applications table
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      DROP COLUMN IF EXISTS "local_government_area"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add the column back if rolling back
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      ADD COLUMN IF NOT EXISTS "local_government_area" varchar
    `);
  }
}
