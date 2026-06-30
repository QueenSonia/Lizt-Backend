import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Convert accounts.creator_id from varchar -> uuid.
 *
 * creator_id references accounts.id (uuid) but was historically stored as
 * varchar. The new Account.creator self-relation (Workstream F — branding
 * resolves through `owner.creator.user`) joins `creator.id = owner.creator_id`,
 * i.e. `uuid = varchar`, which Postgres rejects at runtime:
 *   operator does not exist: uuid = character varying
 * Verified on dev + prod that every non-null creator_id is uuid-castable
 * (0 non-uuid values), so `USING creator_id::uuid` is safe. Guarded on the
 * current column type → idempotent. Runs before the transition data migrations.
 */
export class ConvertAccountsCreatorIdToUuid1916500000000
  implements MigrationInterface
{
  name = 'ConvertAccountsCreatorIdToUuid1916500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF (SELECT data_type FROM information_schema.columns
              WHERE table_name = 'accounts' AND column_name = 'creator_id') <> 'uuid' THEN
          ALTER TABLE "accounts"
            ALTER COLUMN "creator_id" TYPE uuid USING "creator_id"::uuid;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        IF (SELECT data_type FROM information_schema.columns
              WHERE table_name = 'accounts' AND column_name = 'creator_id') = 'uuid' THEN
          ALTER TABLE "accounts"
            ALTER COLUMN "creator_id" TYPE varchar USING "creator_id"::text;
        END IF;
      END $$;
    `);
  }
}
