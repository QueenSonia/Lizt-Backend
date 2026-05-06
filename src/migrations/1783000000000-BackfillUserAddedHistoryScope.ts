import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill `related_entity_type` / `related_entity_id` on `user_added_*`
 * property_history rows. Before this fix, the Add History flow saved these
 * columns as NULL, and the KYC applicant timeline filter
 * (kyc-application.service.getApplicationTimeline) treats NULL-scoped rows
 * as property-wide — so a landlord's Add History entry on tenant A leaked
 * into the timeline of every applicant on the same property.
 *
 * Going forward the service stamps these columns at write time. This
 * migration retroactively tags pre-fix rows so existing data stops leaking.
 *
 * Idempotency: the WHERE clause excludes rows that already have a scope
 * set, so re-running is a no-op.
 */
export class BackfillUserAddedHistoryScope1783000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "property_histories"
      SET "related_entity_type" = 'tenant',
          "related_entity_id"   = "tenant_id"
      WHERE "event_type" IN (
              'user_added_tenancy',
              'user_added_payment',
              'user_added_fee'
            )
        AND "tenant_id" IS NOT NULL
        AND "related_entity_type" IS NULL
        AND "related_entity_id" IS NULL
        AND "deleted_at" IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "property_histories"
      SET "related_entity_type" = NULL,
          "related_entity_id"   = NULL
      WHERE "event_type" IN (
              'user_added_tenancy',
              'user_added_payment',
              'user_added_fee'
            )
        AND "related_entity_type" = 'tenant'
        AND "related_entity_id"   = "tenant_id"
        AND "deleted_at" IS NULL
    `);
  }
}
