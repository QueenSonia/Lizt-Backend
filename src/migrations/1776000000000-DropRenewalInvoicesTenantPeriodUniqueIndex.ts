import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drop the partial unique index uq_renewal_invoices_tenant_period on
 * renewal_invoices (property_tenant_id, start_date) WHERE deleted_at IS NULL.
 *
 * This index was added to the database out of band (no prior migration
 * defines it) and conflicts with the documented billing design: multiple
 * live renewal_invoices rows are allowed per (property_tenant_id, start_date)
 * because tenant-token OB-collector rows and landlord-initiated renewal
 * rows are semantically distinct and may legitimately coexist for the same
 * period. Idempotency for the auto-renewal cron is enforced in application
 * code, not by this index.
 *
 * Concrete failure case this unblocks: a tenant-token outstanding-balance
 * invoice for a period exists, then the landlord calls POST
 * /tenancies/:id/initiate-renewal for the same period — the find-or-create
 * skips the tenant-token row and tries to INSERT a landlord-token row,
 * which this index rejects with a 409 DUPLICATE_ENTRY.
 */
export class DropRenewalInvoicesTenantPeriodUniqueIndex1776000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_renewal_invoices_tenant_period"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Intentional no-op: this index was never defined in source and its
    // presence is incorrect. Re-creating it on rollback would reintroduce
    // the bug. If a future migration needs a constraint here, it should
    // define one deliberately.
  }
}
