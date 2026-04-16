import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lock `users.phone_number` to the canonical `234XXXXXXXXXX` form (no `+`,
 * digits only). All existing rows already match — verified against prod —
 * so this is a pure guard against regressions from any code path that
 * bypasses the TypeORM `@BeforeInsert`/`@BeforeUpdate` hook on Users.
 */
export class AddUserPhoneCanonicalCheck1775000000007
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        ADD CONSTRAINT "users_phone_number_canonical"
        CHECK (phone_number ~ '^234[0-9]{10}$')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
        DROP CONSTRAINT "users_phone_number_canonical"
    `);
  }
}
