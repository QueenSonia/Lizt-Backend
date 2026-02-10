import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Performance indexes for slow endpoints:
 * - /users/login
 * - /users/tenant-list
 * - /api/kyc-applications
 */
export class AddPerformanceIndexes1771100000000 implements MigrationInterface {
  name = 'AddPerformanceIndexes1771100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Index for accounts.creator_id - used in tenant-list endpoint
    // This is the main bottleneck for getTenantsOfAnAdmin query
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_accounts_creator_id" ON "accounts" ("creator_id")
    `);

    // Composite index for accounts by creator_id and role
    // Optimizes queries filtering by both creator and role
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_accounts_creator_role" ON "accounts" ("creator_id", "role")
    `);

    // Index for rents.rent_status - used in INNER JOIN condition
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rents_rent_status" ON "rents" ("rent_status")
    `);

    // Composite index for rents by tenant_id and rent_status
    // Optimizes the tenant-list query's INNER JOIN
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rents_tenant_status" ON "rents" ("tenant_id", "rent_status")
    `);

    // Index for kyc_applications.property_id - used in getAllApplications JOIN
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_kyc_applications_property_id" ON "kyc_applications" ("property_id")
    `);

    // Index for accounts.email - used in login query
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_accounts_email" ON "accounts" ("email")
    `);

    // Composite index for login query (email + role)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_accounts_email_role" ON "accounts" ("email", "role")
    `);

    // Index for users.phone_number - used in login query when logging in with phone
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_users_phone_number" ON "users" ("phone_number")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_phone_number"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_accounts_email_role"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_accounts_email"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_kyc_applications_property_id"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rents_tenant_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rents_rent_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_accounts_creator_role"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_accounts_creator_id"`);
  }
}
