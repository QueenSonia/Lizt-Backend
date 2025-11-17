import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveParkingNeedsColumn1731868000000
  implements MigrationInterface
{
  name = 'RemoveParkingNeedsColumn1731868000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remove parking_needs column from kyc_applications table
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      DROP COLUMN IF EXISTS "parking_needs"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Add the column back if rolling back
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      ADD COLUMN IF NOT EXISTS "parking_needs" varchar
    `);
  }
}
