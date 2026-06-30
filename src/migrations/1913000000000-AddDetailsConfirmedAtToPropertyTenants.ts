import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add a `details_confirmed_at timestamptz` column to `property_tenants` so the
 * bot can durably know whether a tenant has confirmed their tenancy details
 * (the "Yes, correct" tap). NULL = not yet confirmed → the tenant is gated out
 * of the bot until they confirm; a set timestamp = confirmed.
 *
 * Backfill grandfathers every existing ACTIVE tenancy as confirmed so the gate
 * only ever affects tenants added after this ships — no disruption to the live
 * base. The `WHERE status = 'ACTIVE'` here must mirror the guard's active-tenancy
 * selection (see `gateUnconfirmedTenant` in TenantFlowService); that equality is
 * what keeps existing tenants un-gated.
 */
export class AddDetailsConfirmedAtToPropertyTenants1913000000000
  implements MigrationInterface
{
  name = 'AddDetailsConfirmedAtToPropertyTenants1913000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "property_tenants"
        ADD COLUMN IF NOT EXISTS "details_confirmed_at" TIMESTAMPTZ
    `);

    // Grandfather all existing active tenancies as already confirmed.
    // NOTE: the status enum stores lowercase values ('active'/'inactive' —
    // see TenantStatusEnum), so this literal must be lowercase to match.
    await queryRunner.query(`
      UPDATE "property_tenants"
        SET "details_confirmed_at" = now()
      WHERE "status" = 'active'
        AND "details_confirmed_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "property_tenants"
        DROP COLUMN IF EXISTS "details_confirmed_at"
    `);
  }
}
