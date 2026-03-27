import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReplaceIdentityHashWithPhoneUnique1772600000000
  implements MigrationInterface
{
  name = 'ReplaceIdentityHashWithPhoneUnique1772600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop the old unique index on (admin_id, identity_hash)
    await queryRunner.query(
      `DROP INDEX IF EXISTS "unique_tenant_per_landlord"`,
    );

    // Drop the identity_hash column
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" DROP COLUMN IF EXISTS "identity_hash"`,
    );

    // Create new unique index on (admin_id, phone_number)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "unique_tenant_per_landlord" ON "tenant_kyc" ("admin_id", "phone_number")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop the new unique index
    await queryRunner.query(
      `DROP INDEX IF EXISTS "unique_tenant_per_landlord"`,
    );

    // Re-add the identity_hash column
    await queryRunner.query(
      `ALTER TABLE "tenant_kyc" ADD "identity_hash" varchar(64)`,
    );

    // Restore the old unique index on (admin_id, identity_hash)
    await queryRunner.query(
      `CREATE UNIQUE INDEX "unique_tenant_per_landlord" ON "tenant_kyc" ("admin_id", "identity_hash")`,
    );
  }
}
