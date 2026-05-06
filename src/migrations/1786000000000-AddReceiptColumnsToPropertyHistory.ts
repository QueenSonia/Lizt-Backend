import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the lightweight-receipt columns to `property_histories` so
 * `user_added_payment` rows can mint a token + number at create time.
 * Only that one event_type ever populates these columns; everything else
 * leaves them NULL.
 *
 * Postgres unique indexes ignore NULLs by default, so the unique constraint
 * on `receipt_token` doesn't collide with the many NULL-token rows other
 * event_types leave behind.
 *
 * Forward-compatible: nullable columns, no backfill. Older rows remain
 * token-less and the detail modal hides the receipt buttons when the
 * token is NULL.
 */
export class AddReceiptColumnsToPropertyHistory1786000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE property_histories
        ADD COLUMN IF NOT EXISTS receipt_token VARCHAR(64),
        ADD COLUMN IF NOT EXISTS receipt_number VARCHAR(50)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS ux_property_histories_receipt_token
        ON property_histories (receipt_token)
        WHERE receipt_token IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS ux_property_histories_receipt_token
    `);
    await queryRunner.query(`
      ALTER TABLE property_histories
        DROP COLUMN IF EXISTS receipt_number,
        DROP COLUMN IF EXISTS receipt_token
    `);
  }
}
