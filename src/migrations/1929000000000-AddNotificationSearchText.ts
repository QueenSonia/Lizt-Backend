import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds a denormalized `search_text` column to `notification` to power the Live
 * Feed search bar. The column is a normalized (lower + accent-stripped) bag of
 * words assembled from the row's own fields plus its related property, tenants,
 * landlord and maintenance request — baked at write time in
 * `NotificationService.create()` (snapshot semantics). A `pg_trgm` GIN index
 * makes `search_text LIKE '%term%'` index-accelerated regardless of feed size.
 *
 * The backfill below reconstructs the same field set for existing rows using
 * `lower(unaccent(...))` — the SQL equivalent of the JS `normalizeSearchText`
 * helper — so old and new rows behave identically.
 */
export class AddNotificationSearchText1929000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS unaccent`);

    await queryRunner.query(`
      ALTER TABLE "notification"
        ADD COLUMN IF NOT EXISTS "search_text" text
    `);

    // Backfill existing rows. UPDATE ... FROM self-join lets us attach the
    // related tables (concat_ws skips NULLs, so absent relations contribute
    // nothing). Only live tenant links are aggregated.
    await queryRunner.query(`
      UPDATE "notification" n
      SET "search_text" = lower(unaccent(
        concat_ws(' ',
          n.description, n.type,
          p.name, p.location,
          (SELECT string_agg(a.profile_name, ' ')
             FROM property_tenants pt
             JOIN accounts a ON a.id = pt.tenant_id AND a.deleted_at IS NULL
            WHERE pt.property_id = p.id AND pt.deleted_at IS NULL),
          owner.profile_name,
          ou.first_name, ou.last_name,
          mr.issue_category, mr.description, mr.request_id, mr.artisan_name_snapshot
        )))
      FROM "notification" n2
        LEFT JOIN properties p            ON p.id  = n2.property_id
        LEFT JOIN accounts owner          ON owner.id = n2.user_id
        LEFT JOIN users ou                ON ou.id = owner."userId"
        LEFT JOIN maintenance_requests mr ON mr.id = n2.maintenance_request_id
      WHERE n.id = n2.id
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notification_search_text_trgm"
        ON "notification" USING gin ("search_text" gin_trgm_ops)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_notification_search_text_trgm"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notification" DROP COLUMN IF EXISTS "search_text"`,
    );
    // Extensions left in place — harmless and potentially shared.
  }
}
