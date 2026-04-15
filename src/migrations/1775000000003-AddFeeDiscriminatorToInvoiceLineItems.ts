import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Billing v2 — discriminate invoice line items by fee kind and recurring flag.
 *
 * `fee_kind` is nullable because rows predating billing v2 have no discriminator.
 * `external_id` carries the stable id for otherFees so they survive renames
 * across renewals (see common/billing/fees.ts).
 */
export class AddFeeDiscriminatorToInvoiceLineItems1775000000003
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "invoice_line_items"
        ADD COLUMN "fee_kind"     VARCHAR(32),
        ADD COLUMN "is_recurring" BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN "external_id"  VARCHAR(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "invoice_line_items"
        DROP COLUMN "external_id",
        DROP COLUMN "is_recurring",
        DROP COLUMN "fee_kind"
    `);
  }
}
