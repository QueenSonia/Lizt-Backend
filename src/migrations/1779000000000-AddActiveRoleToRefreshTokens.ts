import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist the session's active role on the refresh_tokens row so refresh
 * can re-issue an access token with the same role the user picked at login,
 * instead of falling back to the legacy scalar `accounts.role` column
 * (which mirrors `roles[0]` and silently flips multi-role sessions).
 */
export class AddActiveRoleToRefreshTokens1779000000000
  implements MigrationInterface
{
  name = 'AddActiveRoleToRefreshTokens1779000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const enumTypeRows: Array<{ udt_name: string }> = await queryRunner.query(`
      SELECT udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'accounts'
        AND column_name = 'role'
      LIMIT 1
    `);

    if (!enumTypeRows.length) {
      throw new Error(
        'accounts.role column not found — cannot infer enum type for active_role',
      );
    }
    const enumType = enumTypeRows[0].udt_name;

    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
        ADD COLUMN IF NOT EXISTS "active_role" "${enumType}"
    `);

    await queryRunner.query(`
      UPDATE "refresh_tokens" rt
      SET "active_role" = COALESCE(a."role", a."roles"[1])
      FROM "accounts" a
      WHERE rt."account_id" = a."id"
        AND rt."active_role" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens" DROP COLUMN IF EXISTS "active_role"
    `);
  }
}
