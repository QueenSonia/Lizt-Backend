import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add admin-scope support to `kyc_links`:
 *  - `scope_type` ('landlord' | 'admin', default 'landlord') — legacy/per-landlord
 *    links stay 'landlord'; the property-manager link is 'admin'.
 *  - `admin_creator_id` (uuid, nullable) — the admin whose managed landlords'
 *    vacancies an 'admin' link aggregates.
 *
 * Default 'landlord' means existing public links (tokens in the wild) keep
 * behaving exactly as before. Idempotent via IF NOT EXISTS. Enum type name
 * (`kyc_links_scope_type_enum`) matches the TypeORM-derived name (synchronize off).
 */
export class AddScopeToKycLinks1915000000000 implements MigrationInterface {
  name = 'AddScopeToKycLinks1915000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "kyc_links_scope_type_enum" AS ENUM ('landlord', 'admin');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "kyc_links"
        ADD COLUMN IF NOT EXISTS "scope_type" "kyc_links_scope_type_enum"
        NOT NULL DEFAULT 'landlord'
    `);

    await queryRunner.query(`
      ALTER TABLE "kyc_links"
        ADD COLUMN IF NOT EXISTS "admin_creator_id" uuid
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "kyc_links" DROP COLUMN IF EXISTS "admin_creator_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "kyc_links" DROP COLUMN IF EXISTS "scope_type"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "kyc_links_scope_type_enum"
    `);
  }
}
