import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add `accounts.landlord_type` ('corporate' | 'individual') for the
 * property-manager restructure. Corporate landlords keep their company name in
 * `profile_name`; individuals derive their display name from first+last name.
 *
 * Backfill: every existing account carrying the `landlord` role gets a type so
 * the column is meaningful from day one — `corporate` when a `profile_name` is
 * present (all current landlords have one), else `individual`. Idempotent via
 * `IF NOT EXISTS` + `WHERE landlord_type IS NULL`.
 *
 * The pg enum type name (`accounts_landlord_type_enum`) must match what TypeORM
 * derives from `@Entity('accounts')` + column `landlord_type` so it does not
 * try to recreate it (synchronize is off).
 */
export class AddLandlordTypeToAccounts1914000000000
  implements MigrationInterface
{
  name = 'AddLandlordTypeToAccounts1914000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "accounts_landlord_type_enum" AS ENUM ('corporate', 'individual');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "accounts"
        ADD COLUMN IF NOT EXISTS "landlord_type" "accounts_landlord_type_enum"
    `);

    await queryRunner.query(`
      UPDATE "accounts"
        SET "landlord_type" = CASE
          WHEN "profile_name" IS NOT NULL AND length(trim("profile_name")) > 0
            THEN 'corporate'::"accounts_landlord_type_enum"
          ELSE 'individual'::"accounts_landlord_type_enum"
        END
      WHERE 'landlord' = ANY("roles")
        AND "landlord_type" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "accounts" DROP COLUMN IF EXISTS "landlord_type"
    `);
    await queryRunner.query(`
      DROP TYPE IF EXISTS "accounts_landlord_type_enum"
    `);
  }
}
