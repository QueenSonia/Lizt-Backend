import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddNumberOfCarsOwnedColumn1732000000000
  implements MigrationInterface
{
  name = 'AddNumberOfCarsOwnedColumn1732000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add number_of_cars_owned column to kyc_applications table
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      ADD COLUMN IF NOT EXISTS "number_of_cars_owned" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the column if rolling back
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      DROP COLUMN IF EXISTS "number_of_cars_owned"
    `);
  }
}
