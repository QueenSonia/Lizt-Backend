import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOriginalExpiryDateToRents1773900000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rents"
      ADD COLUMN IF NOT EXISTS "original_expiry_date" TIMESTAMP NULL
    `);

    // Backfill existing rows: the original expiry was whatever expiry_date
    // was before any roll-forward could have touched it. For all existing
    // records this is a safe one-time copy.
    await queryRunner.query(`
      UPDATE "rents"
      SET "original_expiry_date" = "expiry_date"
      WHERE "original_expiry_date" IS NULL
        AND "expiry_date" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "rents" DROP COLUMN "original_expiry_date"
    `);
  }
}
