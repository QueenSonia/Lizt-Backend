import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add a `letter_body_json jsonb` column to `renewal_invoices` for the
 * TipTap/ProseMirror Notion-style renewal-letter editor.
 *
 * JSON becomes the canonical document (structure, prose, block order,
 * formatting); the existing `letter_body_html` becomes a derived snapshot that
 * the tenant page + Puppeteer PDF keep rendering unchanged.
 *
 * Column only — no data backfill. Converting stored HTML → ProseMirror JSON
 * needs the editor schema + a parse ruleset (application code, not SQL), and
 * isn't required up front: legacy rows keep rendering from `letter_body_html`
 * with `letter_body_json = NULL` indefinitely, and are converted lazily by the
 * frontend (`legacyHtmlToDoc`) the first time a landlord opens one to edit.
 */
export class AddRenewalLetterBodyJson1922000000000
  implements MigrationInterface
{
  name = 'AddRenewalLetterBodyJson1922000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        ADD COLUMN IF NOT EXISTS "letter_body_json" JSONB DEFAULT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "renewal_invoices"
        DROP COLUMN IF EXISTS "letter_body_json"
    `);
  }
}
