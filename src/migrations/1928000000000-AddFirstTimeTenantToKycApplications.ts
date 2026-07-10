import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddFirstTimeTenantToKycApplications1928000000000
  implements MigrationInterface
{
  name = 'AddFirstTimeTenantToKycApplications1928000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Tenancy-information fields captured on the KYC form (Property Usage section).
    // Stored as varchar to match the other tenancy columns (number_of_occupants,
    // parking_needs, etc.). is_first_time_tenant holds 'yes' | 'no';
    // number_of_previous_residences is only populated when the applicant is not a
    // first-time tenant.
    await queryRunner.query(`
      ALTER TABLE "kyc_applications"
      ADD COLUMN IF NOT EXISTS "is_first_time_tenant" varchar
    `);
    await queryRunner.query(`
      ALTER TABLE "kyc_applications"
      ADD COLUMN IF NOT EXISTS "number_of_previous_residences" varchar
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_applications"
      DROP COLUMN IF EXISTS "number_of_previous_residences"
    `);
    await queryRunner.query(`
      ALTER TABLE "kyc_applications"
      DROP COLUMN IF EXISTS "is_first_time_tenant"
    `);
  }
}
