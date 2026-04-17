import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Billing v2 — snapshot paid invoice line items onto receipts so the
 * receipt PDF can render an itemized breakdown without joining back to
 * the invoice (and without risk of downstream edits mutating history).
 */
export class AddLineItemsToReceipts1775000000004
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "receipts"
        ADD COLUMN "line_items" JSONB NOT NULL DEFAULT '[]'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "receipts"
        DROP COLUMN "line_items"
    `);
  }
}
