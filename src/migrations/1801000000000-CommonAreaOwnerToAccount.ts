import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes common_areas.owner_id consistent with property.owner_id: both now hold
 * the landlord's Account.id. Previously common_areas.owner_id stored the
 * landlord's User.id (FK → users.id), which forced every ownership check in the
 * app to resolve accounts.userId first — and caused the WhatsApp landlord
 * approve/reject path to deny every common-area request (it compared the
 * User.id owner against the caller's Account.id).
 *
 * Up:
 *  1. Repoint each owner_id from users.id → the landlord-role accounts.id for
 *     that user. Rows whose owner has no landlord-role account are left as-is
 *     and will surface as a loud FK violation in step 2 (intentional — there is
 *     no correct account to map them to).
 *  2. Swap the FK from users(id) to accounts(id).
 *
 * Down: reverse — map accounts.id back to the owning users.id and restore the
 * users(id) FK.
 */
export class CommonAreaOwnerToAccount1801000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the old users(id) FK FIRST. The owner_id rewrite below sets each
    // value to an Account.id, which is not a users.id — leaving the old FK in
    // place would reject the UPDATE with a 23503.
    await queryRunner.query(
      `ALTER TABLE "common_areas" DROP CONSTRAINT IF EXISTS "fk_common_areas_owner"`,
    );

    // 2. owner_id: users.id → landlord accounts.id. A user can hold multiple
    // accounts (per-role); pick the one carrying LANDLORD in roles[]. The
    // correlated subquery keeps this deterministic if a user somehow has more
    // than one landlord account (lowest id wins).
    await queryRunner.query(`
      UPDATE "common_areas" ca
      SET "owner_id" = sub.account_id
      FROM (
        SELECT DISTINCT ON (a."userId") a."userId" AS user_id, a."id" AS account_id
        FROM "accounts" a
        WHERE 'landlord' = ANY(a."roles")
        ORDER BY a."userId", a."id"
      ) sub
      WHERE ca."owner_id" = sub.user_id
    `);

    // 3. Add the new accounts(id) FK. Any owner_id left unmapped in step 2
    // (owner with no landlord-role account) surfaces here as a loud 23503 —
    // intentional, there is no correct account to map it to.
    await queryRunner.query(`
      ALTER TABLE "common_areas"
        ADD CONSTRAINT "fk_common_areas_owner_account"
        FOREIGN KEY ("owner_id") REFERENCES "accounts"("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the accounts(id) FK first (mirror of up): the rewrite below sets
    // owner_id back to a users.id, which the accounts FK would reject.
    await queryRunner.query(
      `ALTER TABLE "common_areas" DROP CONSTRAINT IF EXISTS "fk_common_areas_owner_account"`,
    );

    // 2. owner_id: accounts.id → the owning users.id.
    await queryRunner.query(`
      UPDATE "common_areas" ca
      SET "owner_id" = a."userId"
      FROM "accounts" a
      WHERE a."id" = ca."owner_id"
    `);

    // 3. Restore the users(id) FK.
    await queryRunner.query(`
      ALTER TABLE "common_areas"
        ADD CONSTRAINT "fk_common_areas_owner"
        FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE
    `);
  }
}
