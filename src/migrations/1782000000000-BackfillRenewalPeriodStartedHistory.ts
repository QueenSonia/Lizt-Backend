import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill `renewal_period_started` property_history events for tenancies
 * that pre-date the feature. Without this, existing tenants only see
 * payment-shaped events on their timeline (renewal_payment_initiated,
 * renewal_payment_made) and no entry indicating that a new lease period
 * actually began.
 *
 * Source of truth: every rent row beyond the first per (tenant, property)
 * represents a past renewal period — auto-renewal cron and pay-before-expiry
 * both create a fresh rent row whose start/expiry/rental_price carry the
 * period's terms. The first rent row is the original tenancy (already
 * represented by `tenancy_started` / `user_added_tenancy`), so it's skipped.
 *
 * Idempotency: each inserted row carries `metadata.backfilled = true` so
 * down() can cleanly remove only what this migration created. The NOT EXISTS
 * filter against existing renewal_period_started events also makes up()
 * safe to re-run if it's interrupted.
 *
 * Edge case — tenant moved out then re-attached on the same property:
 * we skip rent rows whose start_date coincides with a tenancy_started
 * (or user_added_tenancy) event, so the second tenancy's first period
 * isn't mis-tagged as a renewal.
 */
export class BackfillRenewalPeriodStartedHistory1782000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "property_histories" (
        "property_id", "tenant_id", "event_type", "event_description",
        "related_entity_id", "related_entity_type",
        "move_in_date", "move_out_date", "monthly_rent",
        "metadata", "created_at", "updated_at"
      )
      SELECT DISTINCT ON (r."tenant_id", r."property_id", r."rent_start_date"::date)
        r."property_id",
        r."tenant_id",
        'renewal_period_started',
        'Renewal period started: '
          || to_char(r."rent_start_date", 'YYYY-MM-DD')
          || ' – '
          || to_char(r."expiry_date", 'YYYY-MM-DD')
          || '. Rent: ₦'
          || trim(to_char(r."rental_price", 'FM999G999G999G999G999'))
          || '. (Backfilled.)',
        r."id",
        'rent',
        r."rent_start_date",
        r."expiry_date",
        r."rental_price",
        jsonb_build_object('backfilled', true, 'source_rent_id', r."id"),
        r."rent_start_date",
        NOW()
      FROM "rents" r
      WHERE r."tenant_id" IS NOT NULL
        AND r."rent_start_date" IS NOT NULL
        AND r."expiry_date" IS NOT NULL
        AND r."deleted_at" IS NULL
        -- Skip the first rent per (tenant, property) — original tenancy.
        AND EXISTS (
          SELECT 1 FROM "rents" earlier
          WHERE earlier."tenant_id"        = r."tenant_id"
            AND earlier."property_id"      = r."property_id"
            AND earlier."rent_start_date" < r."rent_start_date"
            AND earlier."deleted_at" IS NULL
        )
        -- Skip rents whose start coincides with a tenancy_started event
        -- (handles move-out then re-attach on the same property).
        AND NOT EXISTS (
          SELECT 1 FROM "property_histories" ph
          WHERE ph."tenant_id"   = r."tenant_id"
            AND ph."property_id" = r."property_id"
            AND ph."event_type"  IN ('tenancy_started', 'user_added_tenancy')
            AND ph."move_in_date"::date = r."rent_start_date"::date
            AND ph."deleted_at" IS NULL
        )
        -- Skip if a renewal_period_started already exists for this rent
        -- (post-feature rents, or partial re-runs of this migration).
        AND NOT EXISTS (
          SELECT 1 FROM "property_histories" ph
          WHERE ph."event_type"  = 'renewal_period_started'
            AND ph."tenant_id"   = r."tenant_id"
            AND ph."property_id" = r."property_id"
            AND ph."deleted_at" IS NULL
            AND (
              ph."related_entity_id" = r."id"
              OR ph."move_in_date"::date = r."rent_start_date"::date
            )
        )
      -- Within a duplicate (tenant, property, period) group, prefer the most
      -- recently created rent — most likely the canonical/final state.
      ORDER BY r."tenant_id", r."property_id", r."rent_start_date"::date, r."created_at" DESC
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "property_histories"
      WHERE "event_type" = 'renewal_period_started'
        AND "metadata"->>'backfilled' = 'true'
    `);
  }
}
