import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateTenantKycUniqueConstraint1733700000000
  implements MigrationInterface
{
  name = 'UpdateTenantKycUniqueConstraint1733700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the existing unique constraint on identity_hash
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" DROP CONSTRAINT IF EXISTS "UQ_tenant_kyc_identity_hash"`,
    );

    // Drop the unique index if it exists
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_tenant_kyc_identity_hash"`,
    );

    // Drop the composite unique index if it already exists
    await queryRunner.query(
      `DROP INDEX IF EXISTS "unique_tenant_per_landlord"`,
    );

    // Create a composite unique index on admin_id and identity_hash
    await queryRunner.query(
      `CREATE UNIQUE INDEX "unique_tenant_per_landlord" ON "tenant_kyc" ("admin_id", "identity_hash")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the composite unique index
    await queryRunner.query(
      `DROP INDEX IF EXISTS "unique_tenant_per_landlord"`,
    );

    // Restore the original unique constraint on identity_hash
    // Note: This might fail if there are duplicate identity_hash values
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ADD CONSTRAINT "UQ_tenant_kyc_identity_hash" UNIQUE ("identity_hash")`,
    );
  }
}
