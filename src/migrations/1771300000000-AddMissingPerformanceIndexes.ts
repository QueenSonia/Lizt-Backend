import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add missing indexes identified from slow query analysis:
 * - refresh_tokens: composite on (token, is_revoked) for validateRefreshToken
 * - payments: composite on (status, created_at) for checkExpiredPayments
 * - tenant_kyc: index on (user_id, admin_id) for tenant KYC lookups
 * - offer_letters: index on landlord_id for getLandlordPayments
 * - kyc_applications: index on tenant_id for getApplicationsByTenant
 * - accounts: partial index on (id) WHERE deleted_at IS NULL for frequent PK lookups with soft-delete
 */
export class AddMissingPerformanceIndexes1771300000000
  implements MigrationInterface
{
  name = 'AddMissingPerformanceIndexes1771300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index for refresh token validation (token + is_revoked)
    // Covers: WHERE token = $1 AND is_revoked = false
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_refresh_tokens_token_revoked"
      ON "refresh_tokens" ("token", "is_revoked")
    `);

    // Composite index for expired payment checks
    // Covers: WHERE status = 'pending' AND created_at < $1
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payments_status_created"
      ON "payments" ("status", "created_at")
    `);

    // Composite index for tenant KYC lookups by user and admin
    // Covers: WHERE user_id = $1 AND admin_id = $2
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_tenant_kyc_user_admin"
      ON "tenant_kyc" ("user_id", "admin_id")
      WHERE "deleted_at" IS NULL
    `);

    // Index for offer letters by landlord (getLandlordPayments)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_offer_letters_landlord"
      ON "offer_letters" ("landlord_id")
      WHERE "deleted_at" IS NULL
    `);

    // Index for KYC applications by tenant_id
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_kyc_applications_tenant"
      ON "kyc_applications" ("tenant_id")
      WHERE "deleted_at" IS NULL
    `);

    // Partial index for accounts PK lookups with soft-delete filter
    // Covers the very frequent: WHERE id = $1 AND deleted_at IS NULL
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_accounts_id_active"
      ON "accounts" ("id")
      WHERE "deleted_at" IS NULL
    `);

    // Index for payments by offer_letter_id + status (N+1 in getLandlordPayments)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payments_offer_status"
      ON "payments" ("offer_letter_id", "status")
    `);

    // Index for rents by property_id + tenant_id (property detail queries)
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rents_property_tenant"
      ON "rents" ("property_id", "tenant_id")
      WHERE "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_rents_property_tenant"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_payments_offer_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_accounts_id_active"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_kyc_applications_tenant"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_offer_letters_landlord"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tenant_kyc_user_admin"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_payments_status_created"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_refresh_tokens_token_revoked"`,
    );
  }
}
