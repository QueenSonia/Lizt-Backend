import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContactAddressColumn1731869000000
  implements MigrationInterface
{
  name = 'AddContactAddressColumn1731869000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add contact_address column to kyc_applications table
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      ADD COLUMN IF NOT EXISTS "contact_address" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove the column if rolling back
    await queryRunner.query(`
      ALTER TABLE "kyc_applications" 
      DROP COLUMN IF EXISTS "contact_address"
    `);
  }
}
