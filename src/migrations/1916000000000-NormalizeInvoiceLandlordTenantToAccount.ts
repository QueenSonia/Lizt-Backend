import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Normalizes invoices.landlord_id and invoices.tenant_id to hold Account.id,
 * matching the rest of the app (property.owner_id, offer_letters.landlord_id,
 * ad_hoc_invoices, renewal_invoices). Previously both columns held the User.id
 * (FK -> users.id) -- the lone outlier -- which forced generateFromOfferLetter
 * to translate Account.id -> User.id on write and left the direct create()
 * endpoint unable to match property.owner_id (an Account.id).
 *
 * In practice landlord_id is always the landlord's User.id (set via the
 * offer-letter acceptance flow) and tenant_id is ~always NULL (that flow stores
 * the tenant on kyc_application_id, not tenant_id; the direct create() path was
 * non-functional). The rewrite maps each stored User.id to that user's
 * role-appropriate Account.id. Rows with no matching account are left unmapped
 * and surface as a loud FK violation (23503) when the new FK is added --
 * intentional, there is no correct account to map them to. Mirrors
 * CommonAreaOwnerToAccount1801000000000.
 *
 * Up:
 *  1. Drop the old users(id) FKs.
 *  2. landlord_id: users.id -> landlord-role accounts.id.
 *  3. tenant_id:   users.id -> tenant-role accounts.id (only where set).
 *  4. Re-add the FKs against accounts(id), preserving the original ON DELETE
 *     semantics (landlord = NO ACTION, tenant = SET NULL).
 *
 * Down: reverse -- map accounts.id back to accounts.userId and restore users(id).
 */
export class NormalizeInvoiceLandlordTenantToAccount1916000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the old users(id) FKs first. The rewrites below set Account.id
    // values, which the users FKs would reject with a 23503.
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "FK_invoices_landlord"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "FK_invoices_tenant"`,
    );

    // 2. landlord_id: users.id -> landlord-role accounts.id. A user may hold
    // multiple per-role accounts; DISTINCT ON keeps this deterministic (lowest
    // id wins) if there is somehow more than one landlord account.
    await queryRunner.query(`
      UPDATE "invoices" inv
      SET "landlord_id" = sub.account_id
      FROM (
        SELECT DISTINCT ON (a."userId") a."userId" AS user_id, a."id" AS account_id
        FROM "accounts" a
        WHERE 'landlord' = ANY(a."roles")
        ORDER BY a."userId", a."id"
      ) sub
      WHERE inv."landlord_id" = sub.user_id
    `);

    // 3. tenant_id: users.id -> tenant-role accounts.id, only for rows that have
    // a tenant set (nullable; ~always NULL via the offer-letter flow).
    await queryRunner.query(`
      UPDATE "invoices" inv
      SET "tenant_id" = sub.account_id
      FROM (
        SELECT DISTINCT ON (a."userId") a."userId" AS user_id, a."id" AS account_id
        FROM "accounts" a
        WHERE 'tenant' = ANY(a."roles")
        ORDER BY a."userId", a."id"
      ) sub
      WHERE inv."tenant_id" IS NOT NULL
        AND inv."tenant_id" = sub.user_id
    `);

    // 4. Re-add the FKs against accounts(id), preserving the original ON DELETE
    // semantics. Any value left unmapped in steps 2-3 (owner/tenant with no
    // role-appropriate account) surfaces here as a loud 23503 -- intentional.
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD CONSTRAINT "FK_invoices_landlord"
        FOREIGN KEY ("landlord_id") REFERENCES "accounts"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD CONSTRAINT "FK_invoices_tenant"
        FOREIGN KEY ("tenant_id") REFERENCES "accounts"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. Drop the accounts(id) FKs first (mirror of up): the rewrites below set
    // owner/tenant back to a users.id, which the accounts FKs would reject.
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "FK_invoices_landlord"`,
    );
    await queryRunner.query(
      `ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "FK_invoices_tenant"`,
    );

    // 2. landlord_id / tenant_id: accounts.id -> the owning users.id.
    await queryRunner.query(`
      UPDATE "invoices" inv
      SET "landlord_id" = a."userId"
      FROM "accounts" a
      WHERE a."id" = inv."landlord_id"
    `);
    await queryRunner.query(`
      UPDATE "invoices" inv
      SET "tenant_id" = a."userId"
      FROM "accounts" a
      WHERE inv."tenant_id" IS NOT NULL
        AND a."id" = inv."tenant_id"
    `);

    // 3. Restore the users(id) FKs with the original ON DELETE semantics.
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD CONSTRAINT "FK_invoices_landlord"
        FOREIGN KEY ("landlord_id") REFERENCES "users"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD CONSTRAINT "FK_invoices_tenant"
        FOREIGN KEY ("tenant_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE NO ACTION
    `);
  }
}
